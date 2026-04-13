use core::traits::TryInto;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, stop_cheat_block_timestamp, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use tic_tac_toe::erc20_interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use tic_tac_toe::mock_game_adapter::{IMockAdapterHooksDispatcher, IMockAdapterHooksDispatcherTrait};
use tic_tac_toe::mock_erc20::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};
use tic_tac_toe::protocol::{
    IWagerEscrowDispatcher, IWagerEscrowDispatcherTrait, IWagerEscrowSafeDispatcher,
    IWagerEscrowSafeDispatcherTrait, MatchOutcome, WagerConfig, WagerDeadlines, WagerStatus,
};

const STAKE: u256 = 1000_u256;
const T0: u64 = 10_000_u64;

const P1: ContractAddress = 1.try_into().unwrap();
const P2: ContractAddress = 2.try_into().unwrap();
const P3: ContractAddress = 3.try_into().unwrap();
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

fn deploy_escrow(approved_token: ContractAddress) -> ContractAddress {
    let c = declare("wager_escrow").unwrap().contract_class();
    let (a, _) = c.deploy(@array![approved_token.into()]).unwrap();
    a
}

fn deploy_failing_token() -> ContractAddress {
    let c = declare("failing_erc20").unwrap().contract_class();
    let (a, _) = c.deploy(@array![]).unwrap();
    a
}

fn token_bal(token: ContractAddress, account: ContractAddress) -> u256 {
    IERC20Dispatcher { contract_address: token }.balance_of(account)
}

#[test]
fn test_escrow_constructor_rejects_zero_approved_token() {
    let c = declare("wager_escrow").unwrap().contract_class();
    let zero: felt252 = 0;
    match c.deploy(@array![zero]) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(panic_data) => assert_revert_short(panic_data, 'zero_token'),
    }
}

#[feature("safe_dispatcher")]
#[test]
fn test_create_rejects_unwhitelisted_token() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok);

    start_cheat_block_timestamp(escrow, T0);
    start_cheat_caller_address(escrow, P1);

    let bad_token: ContractAddress = 77.try_into().unwrap();
    let cfg = WagerConfig {
        game_adapter: adapter,
        token: bad_token,
        stake: STAKE,
        deadlines: WagerDeadlines { accept_by: T0 + 100_u64, resolve_by: T0 + 200_u64 },
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
fn test_create_reverts_when_transfer_from_fails() {
    let failing_tok = deploy_failing_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(failing_tok);

    start_cheat_block_timestamp(escrow, T0);
    start_cheat_caller_address(escrow, P1);

    let cfg = WagerConfig {
        game_adapter: adapter,
        token: failing_tok,
        stake: STAKE,
        deadlines: WagerDeadlines { accept_by: T0 + 100_u64, resolve_by: T0 + 200_u64 },
        game_params: array![],
    };
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
    let escrow = deploy_escrow(tok);

    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    IMockERC20Dispatcher { contract_address: tok }.mint(P2, STAKE * 2_u256);
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
        game_params: array![],
    };
    let ew = IWagerEscrowDispatcher { contract_address: escrow };
    let wager_id = ew.create(cfg);
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

#[feature("safe_dispatcher")]
#[test]
fn test_create_without_allowance_reverts_erc20_fail() {
    let tok = deploy_mock_token();
    let adapter = deploy_mock_adapter();
    let escrow = deploy_escrow(tok);

    start_cheat_block_timestamp(escrow, T0);
    start_cheat_caller_address(tok, OWNER);
    IMockERC20Dispatcher { contract_address: tok }.mint(P1, STAKE * 2_u256);
    stop_cheat_caller_address(tok);

    start_cheat_caller_address(escrow, P1);
    let cfg = WagerConfig {
        game_adapter: adapter,
        token: tok,
        stake: STAKE,
        deadlines: WagerDeadlines { accept_by: T0 + 100_u64, resolve_by: T0 + 200_u64 },
        game_params: array![],
    };
    let safe = IWagerEscrowSafeDispatcher { contract_address: escrow };
    match safe.create(cfg) {
        Result::Ok(_) => core::panic_with_felt252('expect_fail'),
        Result::Err(p) => assert_revert_short(p, 'erc20_fail'),
    }
    stop_cheat_caller_address(escrow);
    stop_cheat_block_timestamp(escrow);
}
