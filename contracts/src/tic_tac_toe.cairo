// SPDX-License-Identifier: MIT
// Cairo 1.x — Starknet TicTacToe

use starknet::ContractAddress;

#[starknet::interface]
pub trait ITicTacToe<TContractState> {
    fn create_game(ref self: TContractState, opponent: ContractAddress) -> u64;
    fn play_move(ref self: TContractState, game_id: u64, cell: u8);
    fn get_game(self: @TContractState, game_id: u64) -> tictactoe::Game;
}


#[starknet::contract]
pub mod tictactoe {
    use starknet::get_caller_address;
    use starknet::ContractAddress;
    use starknet::storage::{ Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,};

    #[derive(Copy, Drop, Serde, starknet::Store)]
        pub struct Game {
            pub player_x: ContractAddress,
            pub player_o: ContractAddress,
            pub x_bits: u16,   // 9-bit bitboard for X
            pub o_bits: u16,   // 9-bit bitboard for O
            pub turn: u8,      // 0 = X's turn, 1 = O's turn
            pub status: u8,    // 0 = Ongoing, 1 = X Won, 2 = O Won, 3 = Draw
        }
    #[storage]
    struct Storage {
        next_game_id: u64,
        games: Map<u64, Game>,
    }


    #[derive(Drop, Serde, starknet::Event)]
    struct GameCreated {
        game_id: u64,
        player_x: ContractAddress,
        player_o: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        GameCreated: GameCreated,
        MovePlayed: MovePlayed,
        GameWon: GameWon,
        GameDraw: GameDraw,
    }

    #[derive(Drop, Serde, starknet::Event)]
    struct MovePlayed {
        game_id: u64,
        player: ContractAddress,
        cell: u8,
        x_bits: u16,
        o_bits: u16,
        next_turn: u8,
    }

    #[derive(Drop, Serde, starknet::Event)]
    struct GameWon {
        game_id: u64,
        winner: ContractAddress, // X or O who won
        status: u8,              // 1 if X, 2 if O
    }

    #[derive(Drop, Serde, starknet::Event)]
    struct GameDraw {
        game_id: u64,
    }

    // --- Public/external interface via embedded ABI ---
    #[abi(embed_v0)]
    impl TicTacToeImpl of super::ITicTacToe<ContractState> {
        fn create_game(ref self: ContractState, opponent: ContractAddress) -> u64 {
            let caller = get_caller_address();

            // Initialize a new game: caller is X, opponent is O
            let game_id = self.next_game_id.read();
            self.next_game_id.write(game_id + 1_u64);

            let game = Game {
                player_x: caller,
                player_o: opponent,
                x_bits: 0_u16,
                o_bits: 0_u16,
                turn: 0_u8,     // X starts
                status: 0_u8,   // Ongoing
            };

            self.games.write(game_id, game);

            self.emit(Event::GameCreated(GameCreated {
                game_id,
                player_x: caller,
                player_o: opponent,
            }));

            game_id
        }

        /// `cell` in 0..=8
        fn play_move(ref self: ContractState, game_id: u64, cell: u8) {
            // Basic input checks
            assert(cell <= 8_u8, 'bad_cell');
            // Ensure game exists
            let next_id = self.next_game_id.read();
            assert(game_id < next_id, 'unknown_game');

            let mut game = self.games.read(game_id);
            assert(game.status == 0_u8, 'game_over');

            let caller = get_caller_address();

            // Enforce turn ownership
            if game.turn == 0_u8 {
                assert(caller == game.player_x, 'not_x_turn');
            } else {
                assert(caller == game.player_o, 'not_o_turn');
            }

            // Check cell vacancy
            let occupied: u16 = game.x_bits | game.o_bits;
            let mask: u16 = bit_mask(cell);
            assert((occupied & mask) == 0_u16, 'cell_taken');

            // Apply move
            if game.turn == 0_u8 {
                game.x_bits = game.x_bits | mask;
            } else {
                game.o_bits = game.o_bits | mask;
            }

            // Check win/draw
            let mut ended: bool = false;

            if has_winning(game.x_bits) {
                game.status = 1_u8; // X won
                ended = true;
                self.games.write(game_id, game);

                self.emit(Event::GameWon(GameWon {
                    game_id,
                    winner: game.player_x,
                    status: 1_u8,
                }));
            } else if has_winning(game.o_bits) {
                game.status = 2_u8; // O won
                ended = true;
                self.games.write(game_id, game);

                self.emit(Event::GameWon(GameWon {
                    game_id,
                    winner: game.player_o,
                    status: 2_u8,
                }));
            } else {
                // Draw if all 9 bits are taken
                let all_taken: u16 = game.x_bits | game.o_bits;
                if all_taken == 0x01FF_u16 { // 9 lowest bits set
                    game.status = 3_u8; // Draw
                    ended = true;
                    self.games.write(game_id, game);

                    self.emit(Event::GameDraw(GameDraw { game_id }));
                }
            }

            // If not ended, toggle turn and persist
            if !ended {
                game.turn = game.turn ^ 1_u8; // flip turn
                self.games.write(game_id, game);

                self.emit(Event::MovePlayed(MovePlayed {
                    game_id,
                    player: caller,
                    cell,
                    x_bits: game.x_bits,
                    o_bits: game.o_bits,
                    next_turn: game.turn,
                }));
            }
        }

        fn get_game(self: @ContractState, game_id: u64) -> Game {
            let next_id = self.next_game_id.read();
            assert(game_id < next_id, 'unknown_game');
            self.games.read(game_id)
        }
    }
    // --- Internal helpers ---

    // Returns true if `bits` contains any 3-in-a-row.
    // Winning masks (rows, cols, diagonals):
    // 111000000 (448), 000111000 (56), 000000111 (7),
    // 100100100 (292), 010010010 (146), 001001001 (73),
    // 100010001 (273), 001010100 (84)
    fn has_winning(bits: u16) -> bool {
        let r0: u16 = 448_u16;
        let r1: u16 = 56_u16;
        let r2: u16 = 7_u16;
        let c0: u16 = 292_u16;
        let c1: u16 = 146_u16;
        let c2: u16 = 73_u16;
        let d0: u16 = 273_u16;
        let d1: u16 = 84_u16;

        (bits & r0) == r0
            || (bits & r1) == r1
            || (bits & r2) == r2
            || (bits & c0) == c0
            || (bits & c1) == c1
            || (bits & c2) == c2
            || (bits & d0) == d0
            || (bits & d1) == d1
    }

    // Returns a mask with the bit at `cell` set. `cell` in 0..=8.
    fn bit_mask(cell: u8) -> u16 {
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
}
