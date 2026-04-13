// SPDX-License-Identifier: MIT
// Cairo 1.x — Starknet Ultimate TicTacToe
//
// `GameMeta.status` / `get_result`: 0 ongoing, 1 X won, 2 O won, 3 draw.

use starknet::ContractAddress;

#[starknet::interface]
pub trait ITicTacToe<TContractState> {
    fn create_game(ref self: TContractState, opponent: ContractAddress) -> u64;
    /// Only `game_creator` (constructor) may call; binds `wager_id` for escrow settlement reads.
    fn create_game_for(
        ref self: TContractState,
        player_x: ContractAddress,
        player_o: ContractAddress,
        wager_id: u64,
        config: Array<felt252>,
    ) -> u64;
    fn play_move(ref self: TContractState, game_id: u64, board_index: u8, cell_index: u8);
    fn get_game(self: @TContractState, game_id: u64) -> tictactoe::Game;
    /// Exposes derived meta for clients/tests; must stay consistent with `get_game` boards.
    fn get_game_meta(self: @TContractState, game_id: u64) -> tictactoe::GameMeta;
    fn is_final(self: @TContractState, game_id: u64) -> bool;
    fn get_result(self: @TContractState, game_id: u64) -> u8;
    fn get_players(self: @TContractState, game_id: u64) -> (ContractAddress, ContractAddress);
    fn get_wager_id(self: @TContractState, game_id: u64) -> u64;
}

#[starknet::contract]
pub mod tictactoe {
    use core::array::ArrayTrait;
    use core::traits::TryInto;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePathEntry,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct LocalBoard {
        pub x_bits: u16,
        pub o_bits: u16,
        pub status: u8,
    }

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct BoardSet {
        pub b0: LocalBoard,
        pub b1: LocalBoard,
        pub b2: LocalBoard,
        pub b3: LocalBoard,
        pub b4: LocalBoard,
        pub b5: LocalBoard,
        pub b6: LocalBoard,
        pub b7: LocalBoard,
        pub b8: LocalBoard,
    }

    /// Game fields stored once per game (no embedded boards).
    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct GameMeta {
        pub player_x: ContractAddress,
        pub player_o: ContractAddress,
        pub next_board: u8,
        pub turn: u8,
        pub status: u8,
        /// Meta-game X occupancy (which sub-boards X won); updated when a sub-board resolves.
        pub meta_x_bits: u16,
        /// Meta-game O occupancy.
        pub meta_o_bits: u16,
        /// Count of sub-boards with status != 0 (finished).
        pub completed_locals: u8,
        /// Escrow wager id when created via `create_game_for`; 0 for `create_game`.
        pub wager_id: u64,
    }

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct Game {
        pub player_x: ContractAddress,
        pub player_o: ContractAddress,
        pub boards: BoardSet,
        pub next_board: u8,
        pub turn: u8,
        pub status: u8,
    }

    #[storage]
    struct Storage {
        /// Only this address may call `create_game_for`.
        game_creator: ContractAddress,
        next_game_id: u64,
        game_meta: Map<u64, GameMeta>,
        /// Per-game local boards: avoids rewriting all 9 boards on every move.
        boards: Map<u64, Map<u8, LocalBoard>>,
    }

    #[derive(Drop, Serde, starknet::Event)]
    pub struct GameCreated {
        pub game_id: u64,
        pub player_x: ContractAddress,
        pub player_o: ContractAddress,
        pub wager_id: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        GameCreated: GameCreated,
        MovePlayed: MovePlayed,
        GameWon: GameWon,
        GameDraw: GameDraw,
    }

    #[derive(Drop, Serde, starknet::Event)]
    pub struct MovePlayed {
        pub game_id: u64,
        pub player: ContractAddress,
        pub board_index: u8,
        pub cell_index: u8,
        pub next_board: u8,
        pub next_turn: u8,
        pub local_board_status: u8,
        pub game_status: u8,
    }

    #[derive(Drop, Serde, starknet::Event)]
    pub struct GameWon {
        pub game_id: u64,
        pub winner: ContractAddress,
        pub status: u8,
    }

    #[derive(Drop, Serde, starknet::Event)]
    pub struct GameDraw {
        pub game_id: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, game_creator: ContractAddress) {
        self.game_creator.write(game_creator);
    }

    fn empty_local() -> LocalBoard {
        LocalBoard { x_bits: 0_u16, o_bits: 0_u16, status: 0_u8 }
    }

    /// Unset map entries read as zero; normalize to a single canonical empty value.
    fn normalize_local_board(b: LocalBoard) -> LocalBoard {
        if b.x_bits == 0_u16 && b.o_bits == 0_u16 && b.status == 0_u8 {
            empty_local()
        } else {
            b
        }
    }

    fn read_board(self: @ContractState, game_id: u64, index: u8) -> LocalBoard {
        normalize_local_board(self.boards.entry(game_id).read(index))
    }

    fn load_board_set(self: @ContractState, game_id: u64) -> BoardSet {
        BoardSet {
            b0: read_board(self, game_id, 0_u8),
            b1: read_board(self, game_id, 1_u8),
            b2: read_board(self, game_id, 2_u8),
            b3: read_board(self, game_id, 3_u8),
            b4: read_board(self, game_id, 4_u8),
            b5: read_board(self, game_id, 5_u8),
            b6: read_board(self, game_id, 6_u8),
            b7: read_board(self, game_id, 7_u8),
            b8: read_board(self, game_id, 8_u8),
        }
    }

    fn game_from_meta(meta: @GameMeta, boards: BoardSet) -> Game {
        Game {
            player_x: *meta.player_x,
            player_o: *meta.player_o,
            boards,
            next_board: *meta.next_board,
            turn: *meta.turn,
            status: *meta.status,
        }
    }

    fn require_known_game(self: @ContractState, game_id: u64) {
        let next_id = self.next_game_id.read();
        assert(game_id < next_id, 'unknown_game');
    }

    #[abi(embed_v0)]
    impl TicTacToeImpl of super::ITicTacToe<ContractState> {
        fn create_game(ref self: ContractState, opponent: ContractAddress) -> u64 {
            let caller = get_caller_address();
            let zero: ContractAddress = 0.try_into().unwrap();
            assert(opponent != zero, 'zero_opponent');
            assert(caller != opponent, 'same_player');
            let game_id = self.next_game_id.read();
            self.next_game_id.write(game_id + 1_u64);

            let meta = GameMeta {
                player_x: caller,
                player_o: opponent,
                next_board: 9_u8,
                turn: 0_u8,
                status: 0_u8,
                meta_x_bits: 0_u16,
                meta_o_bits: 0_u16,
                completed_locals: 0_u8,
                wager_id: 0_u64,
            };

            self.game_meta.write(game_id, meta);

            self
                .emit(
                    Event::GameCreated(
                        GameCreated {
                            game_id, player_x: caller, player_o: opponent, wager_id: 0_u64,
                        },
                    ),
                );

            game_id
        }

        fn create_game_for(
            ref self: ContractState,
            player_x: ContractAddress,
            player_o: ContractAddress,
            wager_id: u64,
            config: Array<felt252>,
        ) -> u64 {
            assert(get_caller_address() == self.game_creator.read(), 'not_creator');
            let zero: ContractAddress = 0.try_into().unwrap();
            assert(player_x != zero, 'zero_px');
            assert(player_o != zero, 'zero_po');
            assert(player_x != player_o, 'same_player');
            assert(wager_id != 0_u64, 'bad_wager');
            assert(config.is_empty(), 'bad_config');

            let game_id = self.next_game_id.read();
            self.next_game_id.write(game_id + 1_u64);

            let meta = GameMeta {
                player_x,
                player_o,
                next_board: 9_u8,
                turn: 0_u8,
                status: 0_u8,
                meta_x_bits: 0_u16,
                meta_o_bits: 0_u16,
                completed_locals: 0_u8,
                wager_id,
            };

            self.game_meta.write(game_id, meta);

            self.emit(Event::GameCreated(GameCreated { game_id, player_x, player_o, wager_id }));

            game_id
        }

        fn play_move(ref self: ContractState, game_id: u64, board_index: u8, cell_index: u8) {
            assert(board_index <= 8_u8, 'bad_board');
            assert(cell_index <= 8_u8, 'bad_cell');

            let next_id = self.next_game_id.read();
            assert(game_id < next_id, 'unknown_game');

            let mut meta = self.game_meta.read(game_id);
            assert(meta.status == 0_u8, 'game_over');

            let caller = get_caller_address();
            if meta.turn == 0_u8 {
                assert(caller == meta.player_x, 'not_x_turn');
            } else {
                assert(caller == meta.player_o, 'not_o_turn');
            }

            // Forced-board routing
            let nb = meta.next_board;
            if nb == 9_u8 {
                let chosen = read_board(@self, game_id, board_index);
                assert(chosen.status == 0_u8, 'board_done');
            } else {
                let forced = read_board(@self, game_id, nb);
                if forced.status == 0_u8 {
                    assert(board_index == nb, 'wrong_board');
                } else {
                    let chosen = read_board(@self, game_id, board_index);
                    assert(chosen.status == 0_u8, 'board_done');
                }
            }

            let mut local = read_board(@self, game_id, board_index);
            assert(local.status == 0_u8, 'board_done');

            let mask = bit_mask(cell_index);
            let occupied = local.x_bits | local.o_bits;
            assert((occupied & mask) == 0_u16, 'cell_taken');

            if meta.turn == 0_u8 {
                local.x_bits = local.x_bits | mask;
            } else {
                local.o_bits = local.o_bits | mask;
            }

            local.status = compute_local_status(@local);
            self.boards.entry(game_id).write(board_index, local);

            // Incremental meta: sub-board just finished (status was 0 before this move).
            if local.status == 1_u8 {
                meta.meta_x_bits = meta.meta_x_bits | bit_mask(board_index);
                meta.completed_locals = meta.completed_locals + 1_u8;
            } else if local.status == 2_u8 {
                meta.meta_o_bits = meta.meta_o_bits | bit_mask(board_index);
                meta.completed_locals = meta.completed_locals + 1_u8;
            } else if local.status == 3_u8 {
                meta.completed_locals = meta.completed_locals + 1_u8;
            }

            if has_winning(meta.meta_x_bits) {
                meta.status = 1_u8;
                self.game_meta.write(game_id, meta);
                self.emit(Event::GameWon(GameWon { game_id, winner: meta.player_x, status: 1_u8 }));
                return;
            }
            if has_winning(meta.meta_o_bits) {
                meta.status = 2_u8;
                self.game_meta.write(game_id, meta);
                self.emit(Event::GameWon(GameWon { game_id, winner: meta.player_o, status: 2_u8 }));
                return;
            }
            if meta.completed_locals == 9_u8 {
                meta.status = 3_u8;
                self.game_meta.write(game_id, meta);
                self.emit(Event::GameDraw(GameDraw { game_id }));
                return;
            }

            // Ongoing: next forced board from cell_index
            let target = read_board(@self, game_id, cell_index);
            if target.status == 0_u8 {
                meta.next_board = cell_index;
            } else {
                meta.next_board = 9_u8;
            }
            meta.turn = meta.turn ^ 1_u8;

            let local_board_status = local.status;
            self.game_meta.write(game_id, meta);

            self
                .emit(
                    Event::MovePlayed(
                        MovePlayed {
                            game_id,
                            player: caller,
                            board_index,
                            cell_index,
                            next_board: meta.next_board,
                            next_turn: meta.turn,
                            local_board_status,
                            game_status: meta.status,
                        },
                    ),
                );
        }

        fn get_game(self: @ContractState, game_id: u64) -> Game {
            require_known_game(self, game_id);
            let meta = self.game_meta.read(game_id);
            let boards = load_board_set(self, game_id);
            game_from_meta(@meta, boards)
        }

        fn get_game_meta(self: @ContractState, game_id: u64) -> GameMeta {
            require_known_game(self, game_id);
            self.game_meta.read(game_id)
        }

        fn is_final(self: @ContractState, game_id: u64) -> bool {
            require_known_game(self, game_id);
            let meta = self.game_meta.read(game_id);
            meta.status != 0_u8
        }

        fn get_result(self: @ContractState, game_id: u64) -> u8 {
            require_known_game(self, game_id);
            let meta = self.game_meta.read(game_id);
            meta.status
        }

        fn get_players(self: @ContractState, game_id: u64) -> (ContractAddress, ContractAddress) {
            require_known_game(self, game_id);
            let meta = self.game_meta.read(game_id);
            (meta.player_x, meta.player_o)
        }

        fn get_wager_id(self: @ContractState, game_id: u64) -> u64 {
            require_known_game(self, game_id);
            let meta = self.game_meta.read(game_id);
            meta.wager_id
        }
    }

    fn is_local_board_full(board: @LocalBoard) -> bool {
        (*board.x_bits | *board.o_bits) == 0x01FF_u16
    }

    fn compute_local_status(board: @LocalBoard) -> u8 {
        if has_winning(*board.x_bits) {
            return 1_u8;
        }
        if has_winning(*board.o_bits) {
            return 2_u8;
        }
        if is_local_board_full(board) {
            return 3_u8;
        }
        0_u8
    }

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
