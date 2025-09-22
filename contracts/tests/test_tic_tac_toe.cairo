use starknet::ContractAddress;
use core::traits::TryInto;
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address, stop_cheat_caller_address};

use tic_tac_toe::tic_tac_toe::ITicTacToeDispatcher;
use tic_tac_toe::tic_tac_toe::ITicTacToeDispatcherTrait;
use tic_tac_toe::tic_tac_toe::ITicTacToeSafeDispatcher;
use tic_tac_toe::tic_tac_toe::ITicTacToeSafeDispatcherTrait;

fn deploy() -> ContractAddress {
    let contract = declare("tictactoe").unwrap().contract_class();
    let (addr, _) = contract.deploy(@ArrayTrait::new()).unwrap();
    addr
}

const P1: ContractAddress = 1.try_into().unwrap();
const P2: ContractAddress = 2.try_into().unwrap();
const P3: ContractAddress = 3.try_into().unwrap();
const P4: ContractAddress = 4.try_into().unwrap();

#[test]
fn test_create_and_get_game() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    let game = dispatcher.get_game(game_id);
    assert(game.player_x == P1, 'bad_x');
    assert(game.player_o == P2, 'bad_o');
    assert(game.x_bits == 0_u16, 'bad_x_bits');
    assert(game.o_bits == 0_u16, 'bad_o_bits');
    assert(game.turn == 0_u8, 'bad_turn');
    assert(game.status == 0_u8, 'bad_status');
}

#[test]
fn test_play_valid_moves_and_turns() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    dispatcher.play_move(game_id, 0_u8);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 4_u8);
    stop_cheat_caller_address(contract_address);

    let g = dispatcher.get_game(game_id);
    assert(g.x_bits & 1_u16 == 1_u16, 'x0');
    assert(g.o_bits & 16_u16 == 16_u16, 'o4');
    assert(g.turn == 0_u8, 'turn_back_to_x');
    assert(g.status == 0_u8, 'ongoing');
}

#[test]
#[feature("safe_dispatcher")]
fn test_reject_out_of_turn_and_cell_taken() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    dispatcher.play_move(game_id, 0_u8);
    stop_cheat_caller_address(contract_address);

    // X tries again out of turn
    start_cheat_caller_address(contract_address, P1);
    let safe = ITicTacToeSafeDispatcher { contract_address };
    match safe.play_move(game_id, 1_u8) {
        Result::Ok(_) => core::panic_with_felt252('should_fail_not_o_turn'),
        Result::Err(_) => {}
    };
    stop_cheat_caller_address(contract_address);

    // O plays 1 and then tries to play already taken cell 1 again
    start_cheat_caller_address(contract_address, P2);
    dispatcher.play_move(game_id, 1_u8);
    match safe.play_move(game_id, 1_u8) {
        Result::Ok(_) => core::panic_with_felt252('should_fail_cell_taken'),
        Result::Err(_) => {}
    };
    stop_cheat_caller_address(contract_address);
}

#[test]
#[feature("safe_dispatcher")]
fn test_x_wins_and_game_over() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    // X: 0, O: 3, X: 1, O: 4, X: 2 -> X wins row 0
    start_cheat_caller_address(contract_address, P1); dispatcher.play_move(game_id, 0_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2); dispatcher.play_move(game_id, 3_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1); dispatcher.play_move(game_id, 1_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2); dispatcher.play_move(game_id, 4_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1); dispatcher.play_move(game_id, 2_u8); stop_cheat_caller_address(contract_address);

    let g = dispatcher.get_game(game_id);
    assert(g.status == 1_u8, 'x_should_win');

    // Further moves should fail
    start_cheat_caller_address(contract_address, P2);
    let safe = ITicTacToeSafeDispatcher { contract_address };
    match safe.play_move(game_id, 5_u8) {
        Result::Ok(_) => core::panic_with_felt252('should_fail_game_over'),
        Result::Err(_) => {}
    };
    stop_cheat_caller_address(contract_address);
}

#[test]
fn test_draw_game() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    // X:0 O:1 X:2 O:4 X:3 O:5 X:7 O:6 X:8
    start_cheat_caller_address(contract_address, P1); dispatcher.play_move(game_id, 0_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2); dispatcher.play_move(game_id, 1_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1); dispatcher.play_move(game_id, 2_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2); dispatcher.play_move(game_id, 4_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1); dispatcher.play_move(game_id, 3_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2); dispatcher.play_move(game_id, 5_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1); dispatcher.play_move(game_id, 7_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P2); dispatcher.play_move(game_id, 6_u8); stop_cheat_caller_address(contract_address);
    start_cheat_caller_address(contract_address, P1); dispatcher.play_move(game_id, 8_u8); stop_cheat_caller_address(contract_address);

    let g = dispatcher.get_game(game_id);
    assert(g.status == 3_u8, 'should_be_draw');
}

#[test]
#[feature("safe_dispatcher")]
fn test_bad_cell_and_unknown_game() {
    let contract_address = deploy();
    let dispatcher = ITicTacToeDispatcher { contract_address };

    start_cheat_caller_address(contract_address, P1);
    let game_id = dispatcher.create_game(P2);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, P1);
    let safe = ITicTacToeSafeDispatcher { contract_address };
    match safe.play_move(game_id, 9_u8) {
        Result::Ok(_) => core::panic_with_felt252('should_fail_bad_cell'),
        Result::Err(_) => {}
    };
    stop_cheat_caller_address(contract_address);

    match safe.get_game(game_id + 1_u64) {
        Result::Ok(_) => core::panic_with_felt252('should_fail_unknown_game'),
        Result::Err(_) => {}
    };
}


