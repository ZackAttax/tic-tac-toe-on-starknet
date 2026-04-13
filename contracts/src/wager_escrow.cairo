// SPDX-License-Identifier: MIT
//! Single-whitelisted ERC20 wager escrow (v1). Fee-on-transfer and rebasing tokens are not supported.

#[starknet::contract]
pub mod wager_escrow {
    use core::array::ArrayTrait;
    use core::option::OptionTrait;
    use core::traits::TryInto;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use tic_tac_toe::erc20_interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use tic_tac_toe::protocol::{
        IGameAdapterDispatcher, IGameAdapterDispatcherTrait, IWagerEscrow, MatchOutcome, MatchRef,
        WagerConfig, WagerDeadlines, WagerRecord, WagerStatus,
    };

    #[storage]
    struct Storage {
        approved_token: ContractAddress,
        next_wager_id: u64,
        status: Map<u64, WagerStatus>,
        creator: Map<u64, ContractAddress>,
        opponent: Map<u64, ContractAddress>,
        game_adapter: Map<u64, ContractAddress>,
        token: Map<u64, ContractAddress>,
        stake: Map<u64, u256>,
        accept_by: Map<u64, u64>,
        resolve_by: Map<u64, u64>,
        match_adapter: Map<u64, ContractAddress>,
        match_id: Map<u64, u64>,
        params_len: Map<u64, u32>,
        params_slot: Map<(u64, u32), felt252>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, approved_token: ContractAddress) {
        let zero: ContractAddress = 0.try_into().unwrap();
        assert(approved_token != zero, 'zero_token');
        self.approved_token.write(approved_token);
        self.next_wager_id.write(1_u64);
    }

    fn assert_transfer_ok(ok: bool) {
        assert(ok, 'erc20_fail');
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn token_dispatcher(self: @ContractState, wager_id: u64) -> IERC20Dispatcher {
            IERC20Dispatcher { contract_address: self.token.read(wager_id) }
        }

        fn adapter_dispatcher(self: @ContractState, wager_id: u64) -> IGameAdapterDispatcher {
            IGameAdapterDispatcher { contract_address: self.game_adapter.read(wager_id) }
        }

        /// Same rules as `IGameAdapter::validate_config` for the mock adapter (no snapshot in ABI).
        fn assert_opening_config(self: @ContractState, config: @WagerConfig) {
            let zero: ContractAddress = 0.try_into().unwrap();
            let approved = self.approved_token.read();
            assert(*config.token == approved, 'not_whitelisted');
            assert(*config.token != zero, 'bad_token');
            assert(*config.stake > 0_u256, 'bad_stake');
            assert(*config.game_adapter != zero, 'bad_adapter');
            let now = get_block_timestamp();
            assert(*config.deadlines.accept_by > now, 'deadline');
            assert(*config.deadlines.resolve_by > *config.deadlines.accept_by, 'deadlines');
        }

        fn require_known_wager(self: @ContractState, wager_id: u64) {
            let next = self.next_wager_id.read();
            assert(wager_id > 0_u64 && wager_id < next, 'unknown');
        }

        fn read_config(self: @ContractState, wager_id: u64) -> WagerConfig {
            let mut game_params = array![];
            let len: u32 = self.params_len.read(wager_id);
            let mut i: u32 = 0_u32;
            loop {
                if i >= len {
                    break;
                }
                game_params.append(self.params_slot.read((wager_id, i)));
                i = i + 1_u32;
            };
            WagerConfig {
                game_adapter: self.game_adapter.read(wager_id),
                token: self.token.read(wager_id),
                stake: self.stake.read(wager_id),
                deadlines: WagerDeadlines {
                    accept_by: self.accept_by.read(wager_id),
                    resolve_by: self.resolve_by.read(wager_id),
                },
                game_params,
            }
        }

        fn write_params(ref self: ContractState, wager_id: u64, params: Array<felt252>) {
            let len: u32 = params.len();
            self.params_len.write(wager_id, len);
            let mut i: u32 = 0_u32;
            let mut span = params.span();
            loop {
                match span.pop_front() {
                    Option::Some(v) => {
                        self.params_slot.write((wager_id, i), *v);
                        i = i + 1_u32;
                    },
                    Option::None => {
                        break;
                    },
                };
            };
        }
    }

    #[abi(embed_v0)]
    impl EscrowImpl of IWagerEscrow<ContractState> {
        fn create(ref self: ContractState, config: WagerConfig) -> u64 {
            self.assert_opening_config(@config);

            let creator = get_caller_address();
            let escrow_addr = get_contract_address();
            let tok = IERC20Dispatcher { contract_address: config.token };
            let ok = tok.transfer_from(creator, escrow_addr, config.stake);
            assert_transfer_ok(ok);

            let WagerConfig { game_adapter, token, stake, deadlines, game_params } = config;
            let zero: ContractAddress = 0.try_into().unwrap();

            let id = self.next_wager_id.read();
            self.next_wager_id.write(id + 1_u64);

            self.status.write(id, WagerStatus::Open);
            self.creator.write(id, creator);
            self.opponent.write(id, zero);
            self.game_adapter.write(id, game_adapter);
            self.token.write(id, token);
            self.stake.write(id, stake);
            self.accept_by.write(id, deadlines.accept_by);
            self.resolve_by.write(id, deadlines.resolve_by);
            self.match_adapter.write(id, zero);
            self.match_id.write(id, 0_u64);

            self.write_params(id, game_params);

            id
        }

        fn accept(ref self: ContractState, wager_id: u64) {
            assert(self.status.read(wager_id) == WagerStatus::Open, 'bad_state');
            let creator = self.creator.read(wager_id);
            let opp_old = self.opponent.read(wager_id);
            let zero: ContractAddress = 0.try_into().unwrap();
            assert(opp_old == zero, 'has_opp');

            let caller = get_caller_address();
            assert(caller != creator, 'self_match');
            let now = get_block_timestamp();
            assert(now <= self.accept_by.read(wager_id), 'accept_late');

            let stake = self.stake.read(wager_id);
            let escrow_addr = get_contract_address();
            let tok = self.token_dispatcher(wager_id);
            let ok = tok.transfer_from(caller, escrow_addr, stake);
            assert_transfer_ok(ok);

            self.opponent.write(wager_id, caller);

            let cfg = self.read_config(wager_id);
            let expected_adapter = self.game_adapter.read(wager_id);
            let mut adapter = self.adapter_dispatcher(wager_id);
            let mr = adapter.create_match(creator, caller, cfg);
            assert(mr.adapter == expected_adapter, 'mr_adapt');
            let (p_a, p_b) = adapter.normalized_participants(mr);
            assert(p_a == creator && p_b == caller, 'mr_parts');

            self.match_adapter.write(wager_id, expected_adapter);
            self.match_id.write(wager_id, mr.match_id);
            self.status.write(wager_id, WagerStatus::Matched);
        }

        fn cancel(ref self: ContractState, wager_id: u64) {
            assert(self.status.read(wager_id) == WagerStatus::Open, 'bad_state');
            assert(get_caller_address() == self.creator.read(wager_id), 'not_creator');
            let stake = self.stake.read(wager_id);
            let creator = self.creator.read(wager_id);
            let tok = self.token_dispatcher(wager_id);
            let ok = tok.transfer(creator, stake);
            assert_transfer_ok(ok);
            self.status.write(wager_id, WagerStatus::Cancelled);
        }

        fn expire(ref self: ContractState, wager_id: u64) {
            let st = self.status.read(wager_id);
            let now = get_block_timestamp();
            let stake = self.stake.read(wager_id);
            let creator = self.creator.read(wager_id);
            let opponent = self.opponent.read(wager_id);
            let tok = self.token_dispatcher(wager_id);

            if st == WagerStatus::Open {
                assert(now > self.accept_by.read(wager_id), 'not_expired');
                let ok = tok.transfer(creator, stake);
                assert_transfer_ok(ok);
                self.status.write(wager_id, WagerStatus::Expired);
                return;
            }

            if st == WagerStatus::Matched {
                assert(now > self.resolve_by.read(wager_id), 'not_expired');
                let ma = self.match_adapter.read(wager_id);
                let mid = self.match_id.read(wager_id);
                let mr = MatchRef { adapter: ma, match_id: mid };
                let adapter = IGameAdapterDispatcher { contract_address: ma };
                let mo = adapter.normalized_outcome(mr);
                match mo {
                    MatchOutcome::None => {
                        let ok1 = tok.transfer(creator, stake);
                        assert_transfer_ok(ok1);
                        let ok2 = tok.transfer(opponent, stake);
                        assert_transfer_ok(ok2);
                    },
                    MatchOutcome::CreatorWin => {
                        let ok = tok.transfer(creator, stake * 2_u256);
                        assert_transfer_ok(ok);
                    },
                    MatchOutcome::OpponentWin => {
                        let ok = tok.transfer(opponent, stake * 2_u256);
                        assert_transfer_ok(ok);
                    },
                    MatchOutcome::Draw => {
                        let ok1 = tok.transfer(creator, stake);
                        assert_transfer_ok(ok1);
                        let ok2 = tok.transfer(opponent, stake);
                        assert_transfer_ok(ok2);
                    },
                    MatchOutcome::Cancelled => {
                        let ok1 = tok.transfer(creator, stake);
                        assert_transfer_ok(ok1);
                        let ok2 = tok.transfer(opponent, stake);
                        assert_transfer_ok(ok2);
                    },
                    MatchOutcome::Expired => {
                        let ok1 = tok.transfer(creator, stake);
                        assert_transfer_ok(ok1);
                        let ok2 = tok.transfer(opponent, stake);
                        assert_transfer_ok(ok2);
                    },
                }
                self.status.write(wager_id, WagerStatus::Expired);
                return;
            }

            core::panic_with_felt252('bad_state');
        }

        fn resolve(ref self: ContractState, wager_id: u64) -> MatchOutcome {
            assert(self.status.read(wager_id) == WagerStatus::Matched, 'bad_state');
            let now = get_block_timestamp();
            assert(now <= self.resolve_by.read(wager_id), 'late_resolve');

            let ma = self.match_adapter.read(wager_id);
            let mid = self.match_id.read(wager_id);
            let mr = MatchRef { adapter: ma, match_id: mid };
            let adapter = IGameAdapterDispatcher { contract_address: ma };
            let mo = adapter.normalized_outcome(mr);

            let stake = self.stake.read(wager_id);
            let creator = self.creator.read(wager_id);
            let opponent = self.opponent.read(wager_id);
            let tok = self.token_dispatcher(wager_id);

            match mo {
                MatchOutcome::None => {
                    assert(false, 'no_outcome');
                },
                MatchOutcome::CreatorWin => {
                    let ok = tok.transfer(creator, stake * 2_u256);
                    assert_transfer_ok(ok);
                },
                MatchOutcome::OpponentWin => {
                    let ok = tok.transfer(opponent, stake * 2_u256);
                    assert_transfer_ok(ok);
                },
                MatchOutcome::Draw => {
                    let ok1 = tok.transfer(creator, stake);
                    assert_transfer_ok(ok1);
                    let ok2 = tok.transfer(opponent, stake);
                    assert_transfer_ok(ok2);
                },
                MatchOutcome::Cancelled => {
                    let ok1 = tok.transfer(creator, stake);
                    assert_transfer_ok(ok1);
                    let ok2 = tok.transfer(opponent, stake);
                    assert_transfer_ok(ok2);
                },
                MatchOutcome::Expired => {
                    let ok1 = tok.transfer(creator, stake);
                    assert_transfer_ok(ok1);
                    let ok2 = tok.transfer(opponent, stake);
                    assert_transfer_ok(ok2);
                },
            }

            self.status.write(wager_id, WagerStatus::Resolved);
            mo
        }

        fn get_wager(self: @ContractState, wager_id: u64) -> WagerRecord {
            self.require_known_wager(wager_id);
            let cfg = self.read_config(wager_id);
            WagerRecord {
                wager_id,
                status: self.status.read(wager_id),
                config: cfg,
                creator: self.creator.read(wager_id),
                opponent: self.opponent.read(wager_id),
                match_ref: MatchRef {
                    adapter: self.match_adapter.read(wager_id),
                    match_id: self.match_id.read(wager_id),
                },
            }
        }

        fn get_status(self: @ContractState, wager_id: u64) -> WagerStatus {
            self.require_known_wager(wager_id);
            self.status.read(wager_id)
        }
    }
}
