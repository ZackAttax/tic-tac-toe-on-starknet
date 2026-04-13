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
use tic_tac_toe::wager_escrow::wager_escrow::{Event, WagerCreated, WagerResolved};

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

/// Default: no fee; single adapter allowlisted.
fn deploy_escrow(approved_token: ContractAddress, adapter: ContractAddress) -> ContractAddress {
    deploy_escrow_full(approved_token, 0_u16, P0, array![adapter])
}

fn deploy_failing_token() -> ContractAddress {
    let c = declare("failing_erc20").unwrap().contract_class();
    let (a, _) = c.deploy(@array![]).unwrap();
    a
}

fn token_bal(token: ContractAddress, account: ContractAddress) -> u256 {
    IERC20Dispatcher { contract_address: token }.balance_of(account)
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

#[test]
fn test_escrow_constructor_rejects_zero_approved_token() {
    let c = declare("wager_escrow").unwrap().contract_class();
    let zero: felt252 = 0;
    // approved_token, fee_bps, fee_recipient, empty adapter list
    match c.deploy(@array![zero, 0, 0, 0]) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(panic_data) => assert_revert_short(panic_data, 'zero_token'),
    }
}

#[feature("safe_dispatcher")]
#[test]
fn test_mutating_unknown_wager_id_reverts() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok, adapter);
    start_cheat_block_timestamp(escrow, T0);
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P1);
    match safe.accept(999_u64) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'unknown'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[test]
fn test_escrow_constructor_rejects_fee_bps_over_10000() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let c = declare("wager_escrow").unwrap().contract_class();
    match c.deploy(@array![tok.into(), 10001, P0.into(), 1, adapter.into()]) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(panic_data) => assert_revert_short(panic_data, 'bad_fee_bps'),
    }
}

#[test]
fn test_escrow_constructor_rejects_nonzero_fee_with_zero_recipient() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let c = declare("wager_escrow").unwrap().contract_class();
    match c.deploy(@array![tok.into(), 100, 0, 1, adapter.into()]) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(panic_data) => assert_revert_short(panic_data, 'zero_fee_rcpt'),
    }
}

#[test]
fn test_escrow_constructor_rejects_zero_adapter_in_list() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let c = declare("wager_escrow").unwrap().contract_class();
    match c.deploy(@array![tok.into(), 0, 0, 2, adapter.into(), 0]) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(panic_data) => assert_revert_short(panic_data, 'zero_adapter'),
    }
}

#[feature("safe_dispatcher")]
#[test]
fn test_create_rejects_unwhitelisted_token() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok, adapter);

    start_cheat_block_timestamp(escrow, T0);
    start_cheat_caller_address(escrow, P1);

    let bad_token: ContractAddress = 77.try_into().unwrap();
    let cfg = WagerConfig {
        game_adapter: adapter,
        token: bad_token,
        stake: STAKE,
        deadlines: WagerDeadlines { accept_by: T0 + 100_u64, resolve_by: T0 + 200_u64 },
        designated_opponent: P0,
        game_params: array![],
    };
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    match safe.create(cfg) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'not_whitelisted'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[feature("safe_dispatcher")]
#[test]
fn test_create_rejects_non_allowlisted_adapter() {
    let tok = deploy_mock_token();
    let adapter_ok = deploy_mock_adapter();
    let adapter_bad = deploy_mock_adapter();
    let escrow = deploy_escrow(tok, adapter_ok);

    start_cheat_block_timestamp(escrow, T0);
    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    stop_cheat_caller_address(tok);
    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P1);
    let cfg = WagerConfig {
        game_adapter: adapter_bad,
        token: tok,
        stake: STAKE,
        deadlines: WagerDeadlines { accept_by: T0 + 100_u64, resolve_by: T0 + 200_u64 },
        designated_opponent: P0,
        game_params: array![],
    };
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    match safe.create(cfg) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'adapter_denied'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[feature("safe_dispatcher")]
#[test]
fn test_create_reverts_when_transfer_from_fails() {
    let failing_tok = deploy_failing_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(failing_tok, adapter);

    start_cheat_block_timestamp(escrow, T0);
    start_cheat_caller_address(escrow, P1);

    let cfg = cfg_open(adapter, failing_tok);
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    match safe.create(cfg) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'erc20_fail'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[test]
fn test_full_wager_creator_wins_reconciles_balances() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok, adapter);

    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    IMockERC20Dispatcher { contract_address: tok }.mint(P2, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_block_timestamp(escrow, T0);

    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P1);
    let ew = IWagerEscrowDispatcher { contract_address: escrow };
    let wager_id = ew.create(cfg_open(adapter, tok));
    stop_cheat_caller_address(escrow);

    let liab_open = STAKE;
    assert(token_bal(tok, escrow) == liab_open, 'bal_open');

    start_cheat_caller_address(tok, P2);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P2);
    ew.accept(wager_id);
    stop_cheat_caller_address(escrow);

    let liab_matched = STAKE * 2_u256;
    assert(token_bal(tok, escrow) == liab_matched, 'bal_match');

    let rec = ew.get_wager(wager_id);
    let mid = rec.match_ref.match_id;

    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }.test_set_outcome(mid, MatchOutcome::CreatorWin);
    stop_cheat_caller_address(adapter);

    start_cheat_caller_address(escrow, P3);
    let mo = ew.resolve(wager_id);
    stop_cheat_caller_address(escrow);

    assert(mo == MatchOutcome::CreatorWin, 'out');
    assert(token_bal(tok, escrow) == 0_u256, 'bal_esc');
    assert(token_bal(tok, P1) == STAKE * 3_u256, 'p1_win');
    assert(token_bal(tok, P2) == STAKE * 1_u256, 'p2_lose');

    assert(ew.get_status(wager_id) == WagerStatus::Resolved, 'st');
}

#[test]
fn test_draw_no_fee_escrow_empty() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow_full(tok, 0_u16, P0, array![adapter]);

    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    IMockERC20Dispatcher { contract_address: tok }.mint(P2, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_block_timestamp(escrow, T0);

    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P1);
    let ew = IWagerEscrowDispatcher { contract_address: escrow };
    let wager_id = ew.create(cfg_open(adapter, tok));
    stop_cheat_caller_address(escrow);

    start_cheat_caller_address(tok, P2);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P2);
    ew.accept(wager_id);
    stop_cheat_caller_address(escrow);

    let rec = ew.get_wager(wager_id);
    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }.test_set_outcome(rec.match_ref.match_id, MatchOutcome::Draw);
    stop_cheat_caller_address(adapter);

    start_cheat_caller_address(escrow, P3);
    ew.resolve(wager_id);
    stop_cheat_caller_address(escrow);

    assert(token_bal(tok, escrow) == 0_u256, 'esc0');
    assert(token_bal(tok, P1) == STAKE * 2_u256, 'p1');
    assert(token_bal(tok, P2) == STAKE * 2_u256, 'p2');
}

#[test]
fn test_win_with_fee_bps() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let fee_bps: u16 = 100_u16;
    let escrow = deploy_escrow_full(tok, fee_bps, P4, array![adapter]);

    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    IMockERC20Dispatcher { contract_address: tok }.mint(P2, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_block_timestamp(escrow, T0);

    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P1);
    let ew = IWagerEscrowDispatcher { contract_address: escrow };
    let wager_id = ew.create(cfg_open(adapter, tok));
    stop_cheat_caller_address(escrow);

    start_cheat_caller_address(tok, P2);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P2);
    ew.accept(wager_id);
    stop_cheat_caller_address(escrow);

    let pot = STAKE * 2_u256;
    let fb: u256 = fee_bps.into();
    let fee_amt = pot * fb / 10000_u256;
    let winner_amt = pot - fee_amt;

    let rec = ew.get_wager(wager_id);
    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }.test_set_outcome(rec.match_ref.match_id, MatchOutcome::OpponentWin);
    stop_cheat_caller_address(adapter);

    start_cheat_caller_address(escrow, P3);
    ew.resolve(wager_id);
    stop_cheat_caller_address(escrow);

    assert(token_bal(tok, escrow) == 0_u256, 'esc0');
    assert(token_bal(tok, P2) == STAKE + winner_amt, 'p2win');
    assert(token_bal(tok, P4) == fee_amt, 'fee_rcpt');
}

#[feature("safe_dispatcher")]
#[test]
fn test_designated_opponent_wrong_reverts_safe() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok, adapter);

    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    IMockERC20Dispatcher { contract_address: tok }.mint(P3, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_block_timestamp(escrow, T0);

    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P1);
    let cfg = WagerConfig {
        game_adapter: adapter,
        token: tok,
        stake: STAKE,
        deadlines: WagerDeadlines { accept_by: T0 + 100_u64, resolve_by: T0 + 200_u64 },
        designated_opponent: P2,
        game_params: array![],
    };
    let ew = IWagerEscrowDispatcher { contract_address: escrow };
    let wager_id = ew.create(cfg);
    stop_cheat_caller_address(escrow);

    start_cheat_caller_address(tok, P3);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P3);
    match safe.accept(wager_id) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'bad_opponent'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[feature("safe_dispatcher")]
#[test]
fn test_second_accept_reverts() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok, adapter);

    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    IMockERC20Dispatcher { contract_address: tok }.mint(P2, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_block_timestamp(escrow, T0);

    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P1);
    let ew = IWagerEscrowDispatcher { contract_address: escrow };
    let wager_id = ew.create(cfg_open(adapter, tok));
    stop_cheat_caller_address(escrow);

    start_cheat_caller_address(tok, P2);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P2);
    ew.accept(wager_id);
    stop_cheat_caller_address(escrow);

    start_cheat_caller_address(tok, P3);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P3);
    match safe.accept(wager_id) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'bad_state'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[feature("safe_dispatcher")]
#[test]
fn test_second_resolve_reverts() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok, adapter);

    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    IMockERC20Dispatcher { contract_address: tok }.mint(P2, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_block_timestamp(escrow, T0);

    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P1);
    let ew = IWagerEscrowDispatcher { contract_address: escrow };
    let wager_id = ew.create(cfg_open(adapter, tok));
    stop_cheat_caller_address(escrow);

    start_cheat_caller_address(tok, P2);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P2);
    ew.accept(wager_id);
    stop_cheat_caller_address(escrow);

    let rec = ew.get_wager(wager_id);
    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }.test_set_outcome(rec.match_ref.match_id, MatchOutcome::Draw);
    stop_cheat_caller_address(adapter);

    start_cheat_caller_address(escrow, P3);
    ew.resolve(wager_id);
    stop_cheat_caller_address(escrow);

    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    start_cheat_caller_address(escrow, P3);
    match safe.resolve(wager_id) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'bad_state'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}

#[test]
fn test_matched_expire_winner_emits_wager_resolved() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok, adapter);

    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    IMockERC20Dispatcher { contract_address: tok }.mint(P2, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_block_timestamp(escrow, T0);

    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P1);
    let ew = IWagerEscrowDispatcher { contract_address: escrow };
    let wager_id = ew.create(cfg_open(adapter, tok));
    stop_cheat_caller_address(escrow);

    start_cheat_caller_address(tok, P2);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P2);
    ew.accept(wager_id);
    stop_cheat_caller_address(escrow);

    let rec = ew.get_wager(wager_id);
    start_cheat_caller_address(adapter, OWNER);
    IMockAdapterHooksDispatcher { contract_address: adapter }.test_set_outcome(rec.match_ref.match_id, MatchOutcome::CreatorWin);
    stop_cheat_caller_address(adapter);

    let mut spy = spy_events();
    start_cheat_block_timestamp(escrow, T0 + 300_u64);
    start_cheat_caller_address(escrow, P3);
    ew.expire(wager_id);
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);

    spy
        .assert_emitted(
            @array![(
                escrow,
                Event::WagerResolved(
                    WagerResolved {
                        wager_id,
                        outcome_tag: 1_u8,
                        via_expire: true,
                        winner: P1,
                        winner_amount: STAKE * 2_u256,
                        fee_amount: 0_u256,
                    },
                ),
            )],
        );
}

#[test]
fn test_wager_created_event_spy() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok, adapter);

    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_block_timestamp(escrow, T0);

    start_cheat_caller_address(tok, P1);
    IMockERC20Dispatcher { contract_address: tok }.approve(escrow, STAKE);
    stop_cheat_caller_address(tok);

    let mut spy = spy_events();
    start_cheat_caller_address(escrow, P1);
    let ew = IWagerEscrowDispatcher { contract_address: escrow };
    let wager_id = ew.create(cfg_open(adapter, tok));
    stop_cheat_caller_address(escrow);

    spy
        .assert_emitted(
            @array![(
                escrow,
                Event::WagerCreated(
                    WagerCreated {
                        wager_id,
                        creator: P1,
                        game_adapter: adapter,
                        token: tok,
                        stake: STAKE,
                        accept_by: T0 + 100_u64,
                        resolve_by: T0 + 200_u64,
                        designated_opponent: P0,
                    },
                ),
            )],
        );
}

#[feature("safe_dispatcher")]
#[test]
fn test_create_without_allowance_reverts_erc20_fail() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok, adapter);

    start_cheat_block_timestamp(escrow, T0);
    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P1);
    let cfg = cfg_open(adapter, tok);
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    match safe.create(cfg) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'erc20_fail'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}
