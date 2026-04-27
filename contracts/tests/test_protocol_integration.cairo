//! Protocol integration tests (PRD 7): `mock_erc20` + `wager_escrow` + `mock_game_adapter`.
//!
//! **Also covered in `test_wager_escrow.cairo`:** constructor failures, create/accept/resolve happy paths
//! (including fee-on-win via `resolve`), wrong adapter, opponent mismatch, double accept, second resolve,
//! and matched `expire` with **zero fee** + creator win.
//!
//! **This file:** cancel, open/matched `expire` branches, fee-on-win via matched `expire`, time-window
//! rejects, `resolve` with `None` outcome, and token conservation with **deduped** balance aggregation.

use core::array::ArrayTrait;
use core::traits::TryInto;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_block_timestamp, start_cheat_caller_address, stop_cheat_block_timestamp,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use tic_tac_toe::erc20_interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use tic_tac_toe::mock_game_adapter::{IMockAdapterHooksDispatcher, IMockAdapterHooksDispatcherTrait};
use tic_tac_toe::mock_erc20::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};
use tic_tac_toe::protocol::{
    IWagerEscrowDispatcher, IWagerEscrowDispatcherTrait, IWagerEscrowSafeDispatcher,
    IWagerEscrowSafeDispatcherTrait, MatchOutcome, WagerConfig, WagerDeadlines, WagerStatus,
};
use tic_tac_toe::wager_escrow::wager_escrow::{Event, WagerCancelled, WagerRefunded, WagerResolved};

const STAKE: u256 = 1000_u256;
const T0: u64 = 10_000_u64;

const P0: ContractAddress = 0.try_into().unwrap();
const P1: ContractAddress = 1.try_into().unwrap();
const P2: ContractAddress = 2.try_into().unwrap();
const P3: ContractAddress = 3.try_into().unwrap();
const P4: ContractAddress = 4.try_into().unwrap();
const OWNER: ContractAddress = 9.try_into().unwrap();

fn assert_revert_short(mut panic_data: Array<felt252>, expected: felt252) {
    assert(panic_data.len() >= 1, 'pd_len');
    let first = panic_data.pop_front().unwrap();
    assert(first == expected, 'pd_val');
}

fn deploy_mock_token() -> ContractAddress {
    let c = declare("mock_erc20").unwrap().contract_class();
    let (a, _) = c.deploy(@array![OWNER.into()]).unwrap();
    a
}

fn deploy_mock_adapter() -> ContractAddress {
    let c = declare("mock_game_adapter").unwrap().contract_class();
    let (a, _) = c.deploy(@array![OWNER.into()]).unwrap();
    a
}

fn deploy_escrow_full(
    approved_token: ContractAddress,
    fee_bps: u16,
    fee_recipient: ContractAddress,
    mut initial_adapters: Array<ContractAddress>,
) -> ContractAddress {
    let c = declare("wager_escrow").unwrap().contract_class();
    let mut calldata = array![];
    calldata.append(approved_token.into());
    calldata.append(fee_bps.into());
    calldata.append(fee_recipient.into());
    let alen: u32 = initial_adapters.len();
    calldata.append(alen.into());
    let mut i: u32 = 0_u32;
    loop {
        if i >= alen {
            break;
        }
        calldata.append((*initial_adapters.at(i)).into());
        i = i + 1_u32;
    };
    let (a, _) = c.deploy(@calldata).unwrap();
    a
}

fn deploy_escrow_zero_fee(approved_token: ContractAddress, adapter: ContractAddress) -> ContractAddress {
    deploy_escrow_full(approved_token, 0_u16, P0, array![adapter])
}

fn token_bal(token: ContractAddress, account: ContractAddress) -> u256 {
    IERC20Dispatcher { contract_address: token }.balance_of(account)
}

/// Returns true if `needle` appears in `arr` (by address equality).
fn array_contains_address(arr: @Array<ContractAddress>, needle: ContractAddress) -> bool {
    let mut j: u32 = 0_u32;
    let mut found = false;
    loop {
        if j >= arr.len() {
            break;
        }
        if *arr.at(j) == needle {
            found = true;
            break;
        }
        j = j + 1_u32;
    };
    found
}

/// Stable dedupe so conservation sums each account at most once (fee recipient may alias a player).
fn dedup_addresses(mut input: Array<ContractAddress>) -> Array<ContractAddress> {
    let mut out: Array<ContractAddress> = array![];
    let mut i: u32 = 0_u32;
    loop {
        if i >= input.len() {
            break;
        }
        let a = *input.at(i);
        if !array_contains_address(@out, a) {
            out.append(a);
        }
        i = i + 1_u32;
    };
    out
}

fn sum_token_balances(tok: ContractAddress, addrs: @Array<ContractAddress>) -> u256 {
    let d = IERC20Dispatcher { contract_address: tok };
    let mut total: u256 = 0_u256;
    let mut i: u32 = 0_u32;
    loop {
        if i >= addrs.len() {
            break;
        }
        total = total + d.balance_of(*addrs.at(i));
        i = i + 1_u32;
    };
    total
}

/// Sum of balances over deduped `tracked` must equal `expected_total_minted` for the scenario.
fn assert_supply_closed(
    tok: ContractAddress, mut tracked: Array<ContractAddress>, expected_total_minted: u256,
) {
    let uniq = dedup_addresses(tracked);
    let sum = sum_token_balances(tok, @uniq);
    assert(sum == expected_total_minted, 'conservation');
}

fn cfg_open(adapter: ContractAddress, tok: ContractAddress) -> WagerConfig {
    WagerConfig {
        game_adapter: adapter,
        token: tok,
        stake: STAKE,
        deadlines: WagerDeadlines { accept_by: T0 + 100_u64, resolve_by: T0 + 200_u64 },
        designated_opponent: P0,
        game_params: array![],
    }
}

fn mint_pair(
    tok: ContractAddress, a: ContractAddress, b: ContractAddress, amt_each: u256,
) {
    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(a, amt_each);
    IMockERC20Dispatcher { contract_address: tok }.mint(b, amt_each);
    stop_cheat_caller_address(tok);
}

/// Open wager: P1 creator, P2 will accept; returns wager_id after create.
/// Leaves `start_cheat_block_timestamp(escrow, T0)` active so `accept` still sees `now <= accept_by`.
fn setup_open_wager(
    tok: ContractAddress, adapter: ContractAddress, escrow: ContractAddress,
) -> u64 {
    mint_pair(tok, P1, P2, STAKE * 2_u256);
    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);
    start_cheat_block_timestamp(escrow, T0);
    start_cheat_caller_address(escrow, P1);
    let wid = IWagerEscrowDispatcher { contract_address: escrow }.create(cfg_open(adapter, tok));
    stop_cheat_caller_address(escrow);
    wid
}

/// After setup_open_wager: P2 accepts, returns wager_id.
fn accept_wager(tok: ContractAddress, escrow: ContractAddress, wager_id: u64) {
    start_cheat_caller_address(tok, P2);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);
    start_cheat_caller_address(escrow, P2);
    IWagerEscrowDispatcher { contract_address: escrow }.accept(wager_id);
    stop_cheat_caller_address(escrow);
}

// --- Cancel & open expire ---

#[test]
fn integration_cancel_open_refunds_creator_emits_events_and_conserves() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let minted_each: u256 = STAKE * 2_u256;
    let supply_total: u256 = minted_each * 2_u256;

    let wid = setup_open_wager(tok, adapter, escrow);
    assert(token_bal(tok, escrow) == STAKE, 'esc_stake');

    let mut spy = spy_events();
    start_cheat_caller_address(escrow, P1);
    IWagerEscrowDispatcher { contract_address: escrow }.cancel(wid);
    stop_cheat_caller_address(escrow);

    spy
        .assert_emitted(
            @array![
                (
                    escrow,
                    Event::WagerCancelled(WagerCancelled { wager_id: wid }),
                ),
                (
                    escrow,
                    Event::WagerRefunded(WagerRefunded { wager_id: wid, to: P1, amount: STAKE }),
                ),
            ],
        );

    assert(
        IWagerEscrowDispatcher { contract_address: escrow }.get_status(wid) == WagerStatus::Cancelled,
        'st',
    );
    assert(token_bal(tok, escrow) == 0_u256, 'esc0');
    assert(token_bal(tok, P1) == minted_each, 'p1');
    assert_supply_closed(tok, array![P1, P2, escrow, adapter, OWNER], supply_total);
}

#[feature("safe_dispatcher")]
#[test]
fn integration_cancel_non_creator_reverts_not_creator() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let wid = setup_open_wager(tok, adapter, escrow);

    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P2);
    match safe.cancel(wid) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'not_creator'),
    }
    stop_cheat_caller_address(escrow);
}

#[feature("safe_dispatcher")]
#[test]
fn integration_cancel_when_matched_reverts_bad_state() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let wid = setup_open_wager(tok, adapter, escrow);
    accept_wager(tok, escrow, wid);

    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P1);
    match safe.cancel(wid) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'bad_state'),
    }
    stop_cheat_caller_address(escrow);
}

#[test]
fn integration_open_expire_refunds_creator_and_conserves() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let minted_each: u256 = STAKE * 2_u256;
    let supply_total: u256 = minted_each * 2_u256;

    let wid = setup_open_wager(tok, adapter, escrow);

    start_cheat_block_timestamp(escrow, T0 + 150_u64);
    let mut spy = spy_events();
    start_cheat_caller_address(escrow, P3);
    IWagerEscrowDispatcher { contract_address: escrow }.expire(wid);
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);

    spy
        .assert_emitted(
            @array![(
                escrow,
                Event::WagerRefunded(WagerRefunded { wager_id: wid, to: P1, amount: STAKE }),
            )],
        );
    assert(
        IWagerEscrowDispatcher { contract_address: escrow }.get_status(wid) == WagerStatus::Expired,
        'st',
    );
    assert(token_bal(tok, escrow) == 0_u256, 'esc0');
    assert(token_bal(tok, P1) == minted_each, 'p1');
    assert_supply_closed(tok, array![P1, P2, escrow, adapter, OWNER], supply_total);
}

#[feature("safe_dispatcher")]
#[test]
fn integration_open_expire_too_early_reverts_not_expired() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let wid = setup_open_wager(tok, adapter, escrow);

    start_cheat_block_timestamp(escrow, T0 + 50_u64);
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P3);
    match safe.expire(wid) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'not_expired'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

// --- Matched expire branches ---

#[test]
fn integration_matched_expire_none_emits_two_refunds_conserves() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let mint_total: u256 = STAKE * 4_u256;

    let wid = setup_open_wager(tok, adapter, escrow);
    accept_wager(tok, escrow, wid);
    let rec = IWagerEscrowDispatcher { contract_address: escrow }.get_wager(wid);
    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }
        .test_set_outcome(rec.match_ref.match_id, MatchOutcome::None);
    stop_cheat_caller_address(adapter);

    let mut spy = spy_events();
    start_cheat_block_timestamp(escrow, T0 + 250_u64);
    start_cheat_caller_address(escrow, P3);
    IWagerEscrowDispatcher { contract_address: escrow }.expire(wid);
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);

    spy
        .assert_emitted(
            @array![
                (
                    escrow,
                    Event::WagerRefunded(WagerRefunded { wager_id: wid, to: P1, amount: STAKE }),
                ),
                (
                    escrow,
                    Event::WagerRefunded(WagerRefunded { wager_id: wid, to: P2, amount: STAKE }),
                ),
            ],
        );
    assert(
        IWagerEscrowDispatcher { contract_address: escrow }.get_status(wid) == WagerStatus::Expired,
        'st',
    );
    assert(token_bal(tok, escrow) == 0_u256, 'esc0');
    assert(token_bal(tok, P1) == STAKE * 2_u256, 'p1bal');
    assert(token_bal(tok, P2) == STAKE * 2_u256, 'p2bal');
    assert_supply_closed(tok, array![P1, P2, escrow, adapter, OWNER], mint_total);
}

#[test]
fn integration_matched_expire_draw_emits_wager_resolved_via_expire() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let mint_total: u256 = STAKE * 4_u256;

    let wid = setup_open_wager(tok, adapter, escrow);
    accept_wager(tok, escrow, wid);
    let rec = IWagerEscrowDispatcher { contract_address: escrow }.get_wager(wid);
    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }
        .test_set_outcome(rec.match_ref.match_id, MatchOutcome::Draw);
    stop_cheat_caller_address(adapter);

    let mut spy = spy_events();
    start_cheat_block_timestamp(escrow, T0 + 250_u64);
    start_cheat_caller_address(escrow, P3);
    IWagerEscrowDispatcher { contract_address: escrow }.expire(wid);
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);

    let zero: ContractAddress = 0.try_into().unwrap();
    spy
        .assert_emitted(
            @array![(
                escrow,
                Event::WagerResolved(
                    WagerResolved {
                        wager_id: wid,
                        outcome_tag: 3_u8,
                        via_expire: true,
                        winner: zero,
                        winner_amount: 0_u256,
                        fee_amount: 0_u256,
                    },
                ),
            )],
        );
    assert(token_bal(tok, escrow) == 0_u256, 'esc0');
    assert(token_bal(tok, P1) == STAKE * 2_u256, 'p1bal');
    assert(token_bal(tok, P2) == STAKE * 2_u256, 'p2bal');
    assert_supply_closed(tok, array![P1, P2, escrow, adapter, OWNER], mint_total);
}

#[test]
fn integration_matched_expire_adapter_cancelled_emits_two_refunds() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let mint_total: u256 = STAKE * 4_u256;

    let wid = setup_open_wager(tok, adapter, escrow);
    accept_wager(tok, escrow, wid);
    let rec = IWagerEscrowDispatcher { contract_address: escrow }.get_wager(wid);
    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }
        .test_set_outcome(rec.match_ref.match_id, MatchOutcome::Cancelled);
    stop_cheat_caller_address(adapter);

    let mut spy = spy_events();
    start_cheat_block_timestamp(escrow, T0 + 250_u64);
    start_cheat_caller_address(escrow, P3);
    IWagerEscrowDispatcher { contract_address: escrow }.expire(wid);
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);

    spy
        .assert_emitted(
            @array![
                (
                    escrow,
                    Event::WagerRefunded(WagerRefunded { wager_id: wid, to: P1, amount: STAKE }),
                ),
                (
                    escrow,
                    Event::WagerRefunded(WagerRefunded { wager_id: wid, to: P2, amount: STAKE }),
                ),
            ],
        );
    assert(token_bal(tok, escrow) == 0_u256, 'esc0');
    assert(token_bal(tok, P1) == STAKE * 2_u256, 'p1bal');
    assert(token_bal(tok, P2) == STAKE * 2_u256, 'p2bal');
    assert_supply_closed(tok, array![P1, P2, escrow, adapter, OWNER], mint_total);
}

#[test]
fn integration_matched_expire_adapter_expired_emits_two_refunds() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let mint_total: u256 = STAKE * 4_u256;

    let wid = setup_open_wager(tok, adapter, escrow);
    accept_wager(tok, escrow, wid);
    let rec = IWagerEscrowDispatcher { contract_address: escrow }.get_wager(wid);
    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }
        .test_set_outcome(rec.match_ref.match_id, MatchOutcome::Expired);
    stop_cheat_caller_address(adapter);

    let mut spy = spy_events();
    start_cheat_block_timestamp(escrow, T0 + 250_u64);
    start_cheat_caller_address(escrow, P3);
    IWagerEscrowDispatcher { contract_address: escrow }.expire(wid);
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);

    spy
        .assert_emitted(
            @array![
                (
                    escrow,
                    Event::WagerRefunded(WagerRefunded { wager_id: wid, to: P1, amount: STAKE }),
                ),
                (
                    escrow,
                    Event::WagerRefunded(WagerRefunded { wager_id: wid, to: P2, amount: STAKE }),
                ),
            ],
        );
    assert(token_bal(tok, escrow) == 0_u256, 'esc0');
    assert(token_bal(tok, P1) == STAKE * 2_u256, 'p1bal');
    assert(token_bal(tok, P2) == STAKE * 2_u256, 'p2bal');
    assert_supply_closed(tok, array![P1, P2, escrow, adapter, OWNER], mint_total);
}

#[test]
fn integration_matched_expire_creator_win_nonzero_fee_asserts_event_and_balances() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let fee_bps: u16 = 100_u16;
    let escrow = deploy_escrow_full(tok, fee_bps, P4, array![adapter]);
    let mint_total: u256 = STAKE * 4_u256;

    let wid = setup_open_wager(tok, adapter, escrow);
    accept_wager(tok, escrow, wid);
    let rec = IWagerEscrowDispatcher { contract_address: escrow }.get_wager(wid);
    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }
        .test_set_outcome(rec.match_ref.match_id, MatchOutcome::CreatorWin);
    stop_cheat_caller_address(adapter);

    let pot: u256 = STAKE * 2_u256;
    let fb: u256 = fee_bps.into();
    let fee_amt: u256 = pot * fb / 10000_u256;
    let winner_amt: u256 = pot - fee_amt;

    let mut spy = spy_events();
    start_cheat_block_timestamp(escrow, T0 + 250_u64);
    start_cheat_caller_address(escrow, P3);
    IWagerEscrowDispatcher { contract_address: escrow }.expire(wid);
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);

    spy
        .assert_emitted(
            @array![(
                escrow,
                Event::WagerResolved(
                    WagerResolved {
                        wager_id: wid,
                        outcome_tag: 1_u8,
                        via_expire: true,
                        winner: P1,
                        winner_amount: winner_amt,
                        fee_amount: fee_amt,
                    },
                ),
            )],
        );
    assert(token_bal(tok, escrow) == 0_u256, 'esc0');
    assert(token_bal(tok, P4) == fee_amt, 'fee');
    // P1 retained `STAKE` after funding escrow; winner payout adds `winner_amt`.
    assert(token_bal(tok, P1) == STAKE + winner_amt, 'p1win');
    assert_supply_closed(tok, array![P1, P2, P4, escrow, adapter, OWNER], mint_total);
}

#[feature("safe_dispatcher")]
#[test]
fn integration_matched_expire_before_resolve_window_reverts_not_expired() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let wid = setup_open_wager(tok, adapter, escrow);
    accept_wager(tok, escrow, wid);

    start_cheat_block_timestamp(escrow, T0 + 150_u64);
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P3);
    match safe.expire(wid) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'not_expired'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

// --- Resolve & windows ---

#[feature("safe_dispatcher")]
#[test]
fn integration_resolve_while_outcome_none_reverts_no_outcome() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let wid = setup_open_wager(tok, adapter, escrow);
    accept_wager(tok, escrow, wid);

    start_cheat_block_timestamp(escrow, T0 + 120_u64);
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P3);
    match safe.resolve(wid) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'no_outcome'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[feature("safe_dispatcher")]
#[test]
fn integration_accept_after_accept_deadline_reverts_accept_late() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    mint_pair(tok, P1, P2, STAKE * 2_u256);
    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);
    start_cheat_block_timestamp(escrow, T0);
    start_cheat_caller_address(escrow, P1);
    let wid = IWagerEscrowDispatcher { contract_address: escrow }.create(cfg_open(adapter, tok));
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);

    start_cheat_caller_address(tok, P2);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_block_timestamp(escrow, T0 + 150_u64);
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P2);
    match safe.accept(wid) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'accept_late'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[feature("safe_dispatcher")]
#[test]
fn integration_resolve_after_resolve_deadline_reverts_late_resolve() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let wid = setup_open_wager(tok, adapter, escrow);
    accept_wager(tok, escrow, wid);
    let rec = IWagerEscrowDispatcher { contract_address: escrow }.get_wager(wid);
    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }
        .test_set_outcome(rec.match_ref.match_id, MatchOutcome::Draw);
    stop_cheat_caller_address(adapter);

    start_cheat_block_timestamp(escrow, T0 + 250_u64);
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P3);
    match safe.resolve(wid) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'late_resolve'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[feature("safe_dispatcher")]
#[test]
fn integration_second_expire_after_terminal_reverts_bad_state() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let wid = setup_open_wager(tok, adapter, escrow);

    start_cheat_block_timestamp(escrow, T0 + 150_u64);
    start_cheat_caller_address(escrow, P3);
    IWagerEscrowDispatcher { contract_address: escrow }.expire(wid);
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);

    start_cheat_block_timestamp(escrow, T0 + 300_u64);
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P3);
    match safe.expire(wid) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'bad_state'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[test]
fn integration_conservation_dedup_ignores_duplicate_tracked_address() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_zero_fee(tok, adapter);
    let minted_each: u256 = STAKE * 2_u256;
    let supply_total: u256 = minted_each * 2_u256;
    let wid = setup_open_wager(tok, adapter, escrow);
    assert(token_bal(tok, escrow) == STAKE, 'e1');
    // Deliberately pass P1 twice; conservation must not double-count.
    assert_supply_closed(tok, array![P1, P1, P2, escrow], supply_total);
    let _ = wid;
}
