use starknet::ContractAddress;
use core::option::OptionTrait;
use core::traits::TryInto;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address, stop_cheat_caller_address,
    spy_events, EventSpy, EventSpyAssertionsTrait, EventSpyTrait, EventsFilterTrait,
};

use tic_tac_toe::tic_tac_toe::ITicTacToeDispatcher;
use tic_tac_toe::tic_tac_toe::ITicTacToeDispatcherTrait;
use tic_tac_toe::tic_tac_toe::ITicTacToeSafeDispatcher;
use tic_tac_toe::tic_tac_toe::ITicTacToeSafeDispatcherTrait;
use tic_tac_toe::tic_tac_toe::tictactoe::{
    Event, GameCreated, GameWon, GameDraw, MovePlayed, Game, GameMeta, LocalBoard,
};

fn deploy() -> ContractAddress {
    let contract = declare("tictactoe").unwrap().contract_class();
    let (addr, _) = contract.deploy(@ArrayTrait::new()).unwrap();
    addr
}

const P0: ContractAddress = 0.try_into().unwrap();
const P1: ContractAddress = 1.try_into().unwrap();
const P2: ContractAddress = 2.try_into().unwrap();

/// `assert` / `panic_with_felt252` encode the reason as `array![felt252]`.
fn assert_revert_with_felt252(mut panic_data: Array<felt252>, expected: felt252) {
    assert(panic_data.len() == 1, 'bad_panic_len');
    let first = panic_data.pop_front().unwrap();
    assert(first == expected, 'bad_panic_val');
}

/// Exactly `expected` events from `contract_address` in the current spy buffer (see `spy_events` docs).
fn assert_contract_emitted_by_count(
    ref spy: EventSpy, contract_address: ContractAddress, expected: usize
) {
    let evs = spy.get_events().emitted_by(contract_address);
    assert(evs.events.len() == expected, 'evt_cnt');
}

/// No emitted event from `contract_address` may use `forbidden` as the first event key (event name selector).
fn assert_contract_events_exclude_first_key(
    ref spy: EventSpy, contract_address: ContractAddress, forbidden: felt252, err: felt252
) {
    let evs = spy.get_events().emitted_by(contract_address);
    for (_, raw) in evs.events.span() {
        assert(*raw.keys.at(0) != forbidden, err);
    };
}

fn lb(game: @Game, i: u8) -> LocalBoard {
    match i {
        0_u8 => *game.boards.b0,
        1_u8 => *game.boards.b1,
        2_u8 => *game.boards.b2,
        3_u8 => *game.boards.b3,
        4_u8 => *game.boards.b4,
        5_u8 => *game.boards.b5,
        6_u8 => *game.boards.b6,
        7_u8 => *game.boards.b7,
        _ => *game.boards.b8,
    }
}

/// Ground truth for incremental `GameMeta`: OR meta bits from finished local wins; count all finished locals.
fn derive_meta_from_boards(g: @Game) -> (u16, u16, u8) {
    let mut mx: u16 = 0_u16;
    let mut mo: u16 = 0_u16;
    let mut completed: u8 = 0_u8;
    let mut i: u8 = 0_u8;
    loop {
        if i > 8_u8 {
            break;
        }
        let b = lb(g, i);
        if b.status == 1_u8 {
            mx = mx | bit_mask_u16(i);
        } else if b.status == 2_u8 {
            mo = mo | bit_mask_u16(i);
        }
        if b.status != 0_u8 {
            completed = completed + 1_u8;
        }
        i = i + 1_u8;
    };
    (mx, mo, completed)
}

fn assert_meta_matches_game(m: GameMeta, g: @Game) {
    let (mx, mo, c) = derive_meta_from_boards(g);
    assert(m.meta_x_bits == mx, 'mx_bits');
    assert(m.meta_o_bits == mo, 'mo_bits');
    assert(m.completed_locals == c, 'completed');
}

fn assert_meta_eq(a: GameMeta, b: GameMeta) {
    assert(a.player_x == b.player_x, 'm_px');
    assert(a.player_o == b.player_o, 'm_po');
    assert(a.next_board == b.next_board, 'm_nb');
    assert(a.turn == b.turn, 'm_turn');
    assert(a.status == b.status, 'm_st');
    assert(a.meta_x_bits == b.meta_x_bits, 'm_mx');
    assert(a.meta_o_bits == b.meta_o_bits, 'm_mo');
    assert(a.completed_locals == b.completed_locals, 'm_cl');
}

#[test]
fn test_create_initial_state() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    let mut spy = spy_events();
    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    assert_contract_emitted_by_count(ref spy, contract_address, 1_usize);
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    Event::GameCreated(
                        GameCreated { game_id, player_x: P1, player_o: P2 },
                    ),
                ),
            ],
        );
    assert_contract_events_exclude_first_key(
        ref spy, contract_address, selector!("MovePlayed"), 'no_mp_create',
    );
    assert_contract_events_exclude_first_key(
        ref spy, contract_address, selector!("GameWon"), 'no_win_create',
    );
    assert_contract_events_exclude_first_key(
        ref spy, contract_address, selector!("GameDraw"), 'no_draw_create',
    );

    let g = dispatcher.get_game(game_id);
    assert(g.player_x == P1, 'bad_x');
    assert(g.player_o == P2, 'bad_o');
    assert(g.turn == 0_u8, 'bad_turn');
    assert(g.status == 0_u8, 'bad_status');
    assert(g.next_board == 9_u8, 'bad_next');
    let mut i: u8 = 0_u8;
    loop {
        if i > 8_u8 {
            break;
        }
        let b = lb(@g, i);
        assert(b.x_bits == 0_u16 && b.o_bits == 0_u16 && b.status == 0_u8, 'bad_lb');
        i = i + 1_u8;
    };

    let m = dispatcher.get_game_meta(game_id);
    assert_meta_matches_game(m, @g);
}

#[feature("safe_dispatcher")]
#[test]
fn test_create_game_rejects_zero_opponent() {
    let contract_address = deploy();
    let safe = ITicTacToeSafeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    match safe.create_game(P0) {
        Result::Ok(_) => core::panic_with_felt252('expect_revert'),
        Result::Err(panic_data) => assert_revert_with_felt252(panic_data, 'zero_opponent'),
    }
    stop_cheat_caller_address(contract_address);
}

#[feature("safe_dispatcher")]
#[test]
fn test_create_game_rejects_self_opponent() {
    let contract_address = deploy();
    let safe = ITicTacToeSafeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    match safe.create_game(P1) {
        Result::Ok(_) => core::panic_with_felt252('expect_revert'),
        Result::Err(panic_data) => assert_revert_with_felt252(panic_data, 'same_player'),
    }
    stop_cheat_caller_address(contract_address);
}

#[test]
fn test_first_move_any_board_and_routing() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    let mut spy = spy_events();
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 5_u8);
    stop_cheat_caller_address(contract_address);

    assert_contract_emitted_by_count(ref spy, contract_address, 1_usize);
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    Event::MovePlayed(
                        MovePlayed {
                            game_id,
                            player: P1,
                            board_index: 3_u8,
                            cell_index: 5_u8,
                            next_board: 5_u8,
                            next_turn: 1_u8,
                            local_board_status: 0_u8,
                            game_status: 0_u8,
                        },
                    ),
                ),
            ],
        );
    assert_contract_events_exclude_first_key(
        ref spy, contract_address, selector!("GameWon"), 'no_win_move',
    );
    assert_contract_events_exclude_first_key(
        ref spy, contract_address, selector!("GameDraw"), 'no_draw_move',
    );

    let g = dispatcher.get_game(game_id);
    let b3 = lb(@g, 3_u8);
    assert(b3.x_bits & bit_mask_u16(5_u8) != 0_u16, 'x_mark');
    assert(g.turn == 1_u8, 'o_turn');
    assert(g.next_board == 5_u8, 'next_is_cell');
    assert(g.status == 0_u8, 'ongoing');
}

fn bit_mask_u16(cell: u8) -> u16 {
    match cell {
        0_u8 => 1_u16,
        1_u8 => 2_u16,
        2_u8 => 4_u16,
        3_u8 => 8_u16,
        4_u8 => 16_u16,
        5_u8 => 32_u16,
        6_u8 => 64_u16,
        7_u8 => 128_u16,
        _ => 256_u16,
    }
}

#[feature("safe_dispatcher")]
#[test]
fn test_forced_wrong_board_fails() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    dispatcher.play_move(game_id, 4_u8, 0_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    let safe = ITicTacToeSafeDispatcher { contract_address };
    match safe.play_move(game_id, 1_u8, 4_u8) {
        Result::Ok(_) => core::panic_with_felt252('expect_revert'),
        Result::Err(_) => {},
    }
    stop_cheat_caller_address(contract_address);
}

#[test]
fn test_forced_board_succeeds() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    dispatcher.play_move(game_id, 4_u8, 0_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 4_u8);
    stop_cheat_caller_address(contract_address);

    let g = dispatcher.get_game(game_id);
    assert(g.next_board == 4_u8, 'forced_ok');
}

/// When the routed target board is already finished, `next_board` becomes 9 and the player may choose any unfinished local board.
#[test]
fn test_free_choice_immediate_after_forced_target_finished() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    // O wins local board 2 (verified sequence)
    dispatcher.play_move(game_id, 3_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 1_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    // X wins board 4; last cell_index 2 sends to board 2 — already finished -> next_board = 9
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    let g_mid = dispatcher.get_game(game_id);
    assert(lb(@g_mid, 2_u8).status != 0_u8, 'b2_done');
    assert(g_mid.next_board == 9_u8, 'free_choice');
    assert(g_mid.turn == 1_u8, 'o_turn');

    // O chooses board 3 (not the routed cell board 0 from X's last move)
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 0_u8);
    stop_cheat_caller_address(contract_address);

    let g = dispatcher.get_game(game_id);
    assert(lb(@g, 3_u8).o_bits & 1_u16 != 0_u16, 'played_b3');
    assert(g.next_board == 0_u8, 'next_from_cell');
    assert(g.status == 0_u8, 'still_on');
}

#[test]
fn test_local_x_wins_board() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    dispatcher.play_move(game_id, 4_u8, 0_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 4_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 1_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 4_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    let g = dispatcher.get_game(game_id);
    assert(lb(@g, 4_u8).status == 1_u8, 'x_local');
    assert(g.status == 0_u8, 'game_on');

    let m = dispatcher.get_game_meta(game_id);
    assert_meta_matches_game(m, @g);
    assert(m.meta_x_bits == bit_mask_u16(4_u8), 'one_x_meta_bit');
    assert(m.meta_o_bits == 0_u16, 'no_o_meta');
    assert(m.completed_locals == 1_u8, 'one_local_done');
}

#[test]
fn test_local_o_wins_board() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    // O wins board 4 (top row): (0,4),(4,1),(1,4),(4,2),(2,4),(4,0)
    dispatcher.play_move(game_id, 0_u8, 4_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 1_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 1_u8, 4_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 2_u8, 4_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 0_u8);
    stop_cheat_caller_address(contract_address);

    let g = dispatcher.get_game(game_id);
    assert(lb(@g, 4_u8).status == 2_u8, 'o_local');

    let m = dispatcher.get_game_meta(game_id);
    assert_meta_matches_game(m, @g);
    assert(m.meta_o_bits == bit_mask_u16(4_u8), 'one_o_meta_bit');
    assert(m.meta_x_bits == 0_u16, 'no_x_meta');
    assert(m.completed_locals == 1_u8, 'one_local_done_o');
}

/// Local board ends full with no winner (status 3). Sequence found via offline search (seed 0).
#[test]
fn test_local_board_draw() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    dispatcher.play_move(game_id, 6_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 6_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 8_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 5_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 8_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 8_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 8_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 7_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 5_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 6_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 7_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 6_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 2_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 5_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 6_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 7_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 1_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 7_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 8_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 7_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 7_u8);
    stop_cheat_caller_address(contract_address);

    let g = dispatcher.get_game(game_id);
    assert(lb(@g, 4_u8).status == 3_u8, 'local_draw');
    assert(g.status == 0_u8, 'game_on');

    // Incremental meta must match full-board derivation (local draws add to completed_locals only).
    let m = dispatcher.get_game_meta(game_id);
    assert_meta_matches_game(m, @g);
}

/// All nine locals finished without a meta winner — global draw (status 3). Sequence from offline search (seed 0).
#[test]
fn test_global_game_draw() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    dispatcher.play_move(game_id, 2_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 6_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 6_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 8_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 8_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 7_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 7_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 7_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 1_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 8_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 8_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 6_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 6_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 1_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 5_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 2_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 8_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 8_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 2_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 7_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 8_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 6_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 2_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 7_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 7_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 7_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 6_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 6_u8, 7_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 5_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 8_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 5_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 6_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 6_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    let mut spy = spy_events();
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 4_u8);
    stop_cheat_caller_address(contract_address);

    assert_contract_emitted_by_count(ref spy, contract_address, 1_usize);
    spy.assert_emitted(@array![(contract_address, Event::GameDraw(GameDraw { game_id }))]);
    assert_contract_events_exclude_first_key(
        ref spy, contract_address, selector!("MovePlayed"), 'no_mp_draw',
    );
    spy
        .assert_not_emitted(
            @array![
                (
                    contract_address,
                    Event::MovePlayed(
                        MovePlayed {
                            game_id,
                            player: P2,
                            board_index: 4_u8,
                            cell_index: 4_u8,
                            next_board: 9_u8,
                            next_turn: 0_u8,
                            local_board_status: 3_u8,
                            game_status: 3_u8,
                        },
                    ),
                ),
            ],
        );

    let g = dispatcher.get_game(game_id);
    assert(g.status == 3_u8, 'global_draw');
    let mut i: u8 = 0_u8;
    loop {
        if i > 8_u8 {
            break;
        }
        assert(lb(@g, i).status != 0_u8, 'all_done');
        i = i + 1_u8;
    };
}

#[test]
fn test_global_x_wins_meta_row() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    // Meta middle row: win locals 3, 4, 5. After each local win, O bridges to the next target board.
    // Win board 3
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 4_u8);
    stop_cheat_caller_address(contract_address);

    // Win board 4
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 5_u8);
    stop_cheat_caller_address(contract_address);

    // Win board 5
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    let mut spy = spy_events();
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    assert_contract_emitted_by_count(ref spy, contract_address, 1_usize);
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    Event::GameWon(GameWon { game_id, winner: P1, status: 1_u8 }),
                ),
            ],
        );
    assert_contract_events_exclude_first_key(
        ref spy, contract_address, selector!("MovePlayed"), 'no_mp_xwin',
    );
    spy
        .assert_not_emitted(
            @array![
                (
                    contract_address,
                    Event::MovePlayed(
                        MovePlayed {
                            game_id,
                            player: P1,
                            board_index: 5_u8,
                            cell_index: 2_u8,
                            next_board: 9_u8,
                            next_turn: 1_u8,
                            local_board_status: 1_u8,
                            game_status: 1_u8,
                        },
                    ),
                ),
            ],
        );

    let g = dispatcher.get_game(game_id);
    assert(lb(@g, 3_u8).status == 1_u8, 'b3');
    assert(lb(@g, 4_u8).status == 1_u8, 'b4');
    assert(lb(@g, 5_u8).status == 1_u8, 'b5');
    assert(g.status == 1_u8, 'x_meta_row');
}

#[test]
fn test_global_o_wins_meta_row() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    // O wins meta middle row (locals 3, 4, 5) — verified full sequence
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 1_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 2_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8, 0_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 1_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 2_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 3_u8, 0_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 5_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 1_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 5_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 1_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    let mut spy = spy_events();
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 5_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    assert_contract_emitted_by_count(ref spy, contract_address, 1_usize);
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    Event::GameWon(GameWon { game_id, winner: P2, status: 2_u8 }),
                ),
            ],
        );
    assert_contract_events_exclude_first_key(
        ref spy, contract_address, selector!("MovePlayed"), 'no_mp_owin',
    );
    spy
        .assert_not_emitted(
            @array![
                (
                    contract_address,
                    Event::MovePlayed(
                        MovePlayed {
                            game_id,
                            player: P2,
                            board_index: 5_u8,
                            cell_index: 2_u8,
                            next_board: 9_u8,
                            next_turn: 0_u8,
                            local_board_status: 2_u8,
                            game_status: 2_u8,
                        },
                    ),
                ),
            ],
        );

    let g = dispatcher.get_game(game_id);
    assert(lb(@g, 3_u8).status == 2_u8, 'o3');
    assert(lb(@g, 4_u8).status == 2_u8, 'o4');
    assert(lb(@g, 5_u8).status == 2_u8, 'o5');
    assert(g.status == 2_u8, 'o_meta');
}

#[feature("safe_dispatcher")]
#[test]
fn test_invalid_moves_safe() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };
    let safe = ITicTacToeSafeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    match safe.play_move(game_id, 9_u8, 0_u8) {
        Result::Ok(_) => core::panic_with_felt252('bad_board'),
        Result::Err(_) => {},
    }
    match safe.play_move(game_id, 0_u8, 9_u8) {
        Result::Ok(_) => core::panic_with_felt252('bad_cell'),
        Result::Err(_) => {},
    }
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    match safe.get_game(game_id + 1_u64) {
        Result::Ok(_) => core::panic_with_felt252('unknown'),
        Result::Err(_) => {},
    }
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 0_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    match safe.play_move(game_id, 0_u8, 0_u8) {
        Result::Ok(_) => core::panic_with_felt252('cell_taken'),
        Result::Err(_) => {},
    }
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 1_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    match safe.play_move(game_id, 1_u8, 0_u8) {
        Result::Ok(_) => core::panic_with_felt252('not_x'),
        Result::Err(_) => {},
    }
    stop_cheat_caller_address(contract_address);
}

#[feature("safe_dispatcher")]
#[test]
fn test_board_done_reverts() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };
    let safe = ITicTacToeSafeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    dispatcher.play_move(game_id, 3_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 1_u8, 2_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    let g = dispatcher.get_game(game_id);
    assert(lb(@g, 2_u8).status != 0_u8, 'b2_fin');
    assert(g.next_board == 9_u8, 'free');

    let meta_before = dispatcher.get_game_meta(game_id);
    assert_meta_matches_game(meta_before, @g);

    start_cheat_caller_address(contract_address, P1);
    match safe.play_move(game_id, 2_u8, 0_u8) {
        Result::Ok(_) => core::panic_with_felt252('board_done'),
        Result::Err(_) => {},
    }
    stop_cheat_caller_address(contract_address);

    let g_after = dispatcher.get_game(game_id);
    let meta_after = dispatcher.get_game_meta(game_id);
    assert_meta_eq(meta_before, meta_after);
    assert_meta_matches_game(meta_after, @g_after);
}

#[feature("safe_dispatcher")]
#[test]
fn test_game_over_no_moves() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };
    let safe = ITicTacToeSafeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    // Same meta win as test_global_x_wins_meta_row
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 3_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 3_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 4_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 4_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 2_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 0_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 0_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 1_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8, 5_u8);
    stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 5_u8, 2_u8);
    stop_cheat_caller_address(contract_address);

    let g = dispatcher.get_game(game_id);
    assert(g.status == 1_u8, 'x_won');

    start_cheat_caller_address(contract_address, P2);
    match safe.play_move(game_id, 3_u8, 3_u8) {
        Result::Ok(_) => core::panic_with_felt252('game_over'),
        Result::Err(_) => {},
    }
    stop_cheat_caller_address(contract_address);
}
