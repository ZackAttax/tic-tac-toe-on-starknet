use core::option::OptionTrait;
use core::serde::Serde;
use core::traits::TryInto;
use starknet::ContractAddress;
use tic_tac_toe::protocol::{
    MatchOutcome, MatchRef, WagerConfig, WagerDeadlines, WagerRecord, WagerStatus,
};

fn addr(n: felt252) -> ContractAddress {
    n.try_into().unwrap()
}

fn assert_felt_arrays_eq(mut a: Array<felt252>, mut b: Array<felt252>) {
    assert(a.len() == b.len(), 'arr_len');
    loop {
        if a.is_empty() {
            break;
        }
        let x = a.pop_front().unwrap();
        let y = b.pop_front().unwrap();
        assert(x == y, 'arr_elt');
    };
}

/// Exercises `tic_tac_toe::protocol` paths and Serde for nested `Array<felt252>` (`WagerConfig`).
#[test]
fn test_wager_config_serde_roundtrip() {
    let deadlines = WagerDeadlines { accept_by: 10_u64, resolve_by: 99_u64 };
    let game_params = array![7_felt252, 8_felt252, 9_felt252];
    let config = WagerConfig {
        game_adapter: addr(1), token: addr(2), stake: 42_u256, deadlines, game_params,
    };

    let mut serialized = array![];
    Serde::serialize(@config, ref serialized);

    let mut span = serialized.span();
    let restored = match Serde::<WagerConfig>::deserialize(ref span) {
        Option::Some(c) => c,
        Option::None => core::panic_with_felt252('serde_wager_cfg'),
    };
    assert(span.is_empty(), 'serde_trailing');

    assert(restored.game_adapter == config.game_adapter, 'ga');
    assert(restored.token == config.token, 'tok');
    assert(restored.stake == config.stake, 'stake');
    assert(restored.deadlines.accept_by == config.deadlines.accept_by, 'ab');
    assert(restored.deadlines.resolve_by == config.deadlines.resolve_by, 'rb');
    assert_felt_arrays_eq(restored.game_params, config.game_params);
}

#[test]
fn test_enums_and_match_ref_copyable() {
    let mo = MatchOutcome::CreatorWin;
    let _m2 = mo;
    let _ = MatchOutcome::None;

    let ws = WagerStatus::Matched;
    let _w2 = ws;

    let r = MatchRef { adapter: addr(5), match_id: 7_u64 };
    let r2 = r;
    assert(r2.match_id == 7_u64, 'mid');
}

#[test]
fn test_wager_record_serde_roundtrip() {
    let deadlines = WagerDeadlines { accept_by: 1_u64, resolve_by: 2_u64 };
    let cfg = WagerConfig {
        game_adapter: addr(11),
        token: addr(12),
        stake: 3_u256,
        deadlines,
        game_params: array![100_felt252],
    };
    let rec = WagerRecord {
        wager_id: 9_u64,
        status: WagerStatus::Open,
        config: cfg,
        creator: addr(20),
        opponent: addr(21),
        match_ref: MatchRef { adapter: addr(0), match_id: 0_u64 },
    };

    let mut buf = array![];
    Serde::serialize(@rec, ref buf);
    let mut sp = buf.span();
    let out = match Serde::<WagerRecord>::deserialize(ref sp) {
        Option::Some(r) => r,
        Option::None => core::panic_with_felt252('serde_rec'),
    };
    assert(sp.is_empty(), 'rec_tail');
    assert(out.wager_id == rec.wager_id, 'wid');
    match (out.status, rec.status) {
        (WagerStatus::Open, WagerStatus::Open) => {},
        _ => core::panic_with_felt252('st'),
    }
    assert(out.creator == rec.creator, 'cr');
    assert(out.opponent == rec.opponent, 'op');
    assert(out.match_ref.match_id == rec.match_ref.match_id, 'mr');
    assert(out.config.stake == rec.config.stake, 'cfg_st');
}
