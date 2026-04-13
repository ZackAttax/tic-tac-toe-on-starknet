// SPDX-License-Identifier: MIT
//! Single-whitelisted ERC20 wager escrow (v1). Fee-on-transfer and rebasing tokens are not supported.
//!
//! **CEI:** On **terminal settlement** (`cancel`, `expire`, `resolve`), checks and adapter reads run
//! first, then the wager is moved to a **terminal `WagerStatus`** before any ERC20 payout `transfer`,
//! then events record the outcome. A failing transfer reverts the whole transaction (including the
//! status write). `accept` pulls the opponent stake, then calls `create_match`, then records `Matched`.

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
        fee_bps: u16,
        fee_recipient: ContractAddress,
        adapter_allowed: Map<ContractAddress, bool>,
        next_wager_id: u64,
        status: Map<u64, WagerStatus>,
        creator: Map<u64, ContractAddress>,
        opponent: Map<u64, ContractAddress>,
        designated_opponent: Map<u64, ContractAddress>,
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

    #[derive(Drop, Serde, starknet::Event)]
    pub struct WagerCreated {
        pub wager_id: u64,
        pub creator: ContractAddress,
        pub game_adapter: ContractAddress,
        pub token: ContractAddress,
        pub stake: u256,
        pub accept_by: u64,
        pub resolve_by: u64,
        pub designated_opponent: ContractAddress,
    }

    #[derive(Drop, Serde, starknet::Event)]
    pub struct WagerAccepted {
        pub wager_id: u64,
        pub opponent: ContractAddress,
        pub match_id: u64,
    }

    #[derive(Drop, Serde, starknet::Event)]
    pub struct WagerCancelled {
        pub wager_id: u64,
    }

    /// Outcome-driven settlement (win / draw / forced refund with definitive adapter outcome).
    #[derive(Drop, Serde, starknet::Event)]
    pub struct WagerResolved {
        pub wager_id: u64,
        /// 0=None, 1=CreatorWin, 2=OpponentWin, 3=Draw, 4=Cancelled, 5=Expired (mirror `MatchOutcome`).
        pub outcome_tag: u8,
        pub via_expire: bool,
        pub winner: ContractAddress,
        pub winner_amount: u256,
        pub fee_amount: u256,
    }

    #[derive(Drop, Serde, starknet::Event)]
    pub struct WagerRefunded {
        pub wager_id: u64,
        pub to: ContractAddress,
        pub amount: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        WagerCreated: WagerCreated,
        WagerAccepted: WagerAccepted,
        WagerCancelled: WagerCancelled,
        WagerResolved: WagerResolved,
        WagerRefunded: WagerRefunded,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        approved_token: ContractAddress,
        fee_bps: u16,
        fee_recipient: ContractAddress,
        initial_adapters: Array<ContractAddress>,
    ) {
        let zero: ContractAddress = 0.try_into().unwrap();
        assert(approved_token != zero, 'zero_token');
        assert(fee_bps <= 10000_u16, 'bad_fee_bps');
        if fee_bps > 0_u16 {
            assert(fee_recipient != zero, 'zero_fee_rcpt');
        }
        self.approved_token.write(approved_token);
        self.fee_bps.write(fee_bps);
        self.fee_recipient.write(fee_recipient);
        self.next_wager_id.write(1_u64);

        let mut i: u32 = 0_u32;
        let len = initial_adapters.len();
        loop {
            if i >= len {
                break;
            }
            let addr = *initial_adapters.at(i);
            assert(addr != zero, 'zero_adapter');
            self.adapter_allowed.write(addr, true);
            i = i + 1_u32;
        };
    }

    fn assert_transfer_ok(ok: bool) {
        assert(ok, 'erc20_fail');
    }

    fn outcome_tag(mo: MatchOutcome) -> u8 {
        match mo {
            MatchOutcome::None => 0_u8,
            MatchOutcome::CreatorWin => 1_u8,
            MatchOutcome::OpponentWin => 2_u8,
            MatchOutcome::Draw => 3_u8,
            MatchOutcome::Cancelled => 4_u8,
            MatchOutcome::Expired => 5_u8,
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn token_dispatcher(self: @ContractState, wager_id: u64) -> IERC20Dispatcher {
            IERC20Dispatcher { contract_address: self.token.read(wager_id) }
        }

        fn adapter_dispatcher(self: @ContractState, wager_id: u64) -> IGameAdapterDispatcher {
            IGameAdapterDispatcher { contract_address: self.game_adapter.read(wager_id) }
        }

        fn assert_opening_config(self: @ContractState, config: @WagerConfig) {
            let zero: ContractAddress = 0.try_into().unwrap();
            let approved = self.approved_token.read();
            assert(*config.token == approved, 'not_whitelisted');
            assert(*config.token != zero, 'bad_token');
            assert(*config.stake > 0_u256, 'bad_stake');
            assert(*config.game_adapter != zero, 'bad_adapter');
            assert(self.adapter_allowed.read(*config.game_adapter), 'adapter_denied');
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
                designated_opponent: self.designated_opponent.read(wager_id),
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

        /// Returns `(winner_amount, fee_amount)` for the full pot `2 * stake`.
        fn split_win_pot(ref self: ContractState, stake: u256) -> (u256, u256) {
            let pot = stake * 2_u256;
            let bps_u16: u16 = self.fee_bps.read();
            let bps: u256 = bps_u16.into();
            if bps == 0_u256 {
                return (pot, 0_u256);
            }
            let fee_amt = pot * bps / 10000_u256;
            (pot - fee_amt, fee_amt)
        }

        fn pay_win(
            ref self: ContractState,
            wager_id: u64,
            winner: ContractAddress,
            stake: u256,
            mo: MatchOutcome,
            via_expire: bool,
        ) {
            let tok = self.token_dispatcher(wager_id);
            let (winner_amt, fee_amt) = self.split_win_pot(stake);
            if fee_amt > 0_u256 {
                let rcpt = self.fee_recipient.read();
                let okf = tok.transfer(rcpt, fee_amt);
                assert_transfer_ok(okf);
            }
            let okw = tok.transfer(winner, winner_amt);
            assert_transfer_ok(okw);
            self
                .emit(
                    Event::WagerResolved(
                        WagerResolved {
                            wager_id,
                            outcome_tag: outcome_tag(mo),
                            via_expire,
                            winner,
                            winner_amount: winner_amt,
                            fee_amount: fee_amt,
                        },
                    ),
                );
        }

        fn pay_draw(
            ref self: ContractState,
            wager_id: u64,
            creator: ContractAddress,
            opponent: ContractAddress,
            stake: u256,
            via_expire: bool,
        ) {
            let tok = self.token_dispatcher(wager_id);
            let ok1 = tok.transfer(creator, stake);
            assert_transfer_ok(ok1);
            let ok2 = tok.transfer(opponent, stake);
            assert_transfer_ok(ok2);
            let zero: ContractAddress = 0.try_into().unwrap();
            self
                .emit(
                    Event::WagerResolved(
                        WagerResolved {
                            wager_id,
                            outcome_tag: outcome_tag(MatchOutcome::Draw),
                            via_expire,
                            winner: zero,
                            winner_amount: 0_u256,
                            fee_amount: 0_u256,
                        },
                    ),
                );
        }

        fn refund_two(
            ref self: ContractState,
            wager_id: u64,
            a: ContractAddress,
            b: ContractAddress,
            stake: u256,
        ) {
            let tok = self.token_dispatcher(wager_id);
            let ok1 = tok.transfer(a, stake);
            assert_transfer_ok(ok1);
            let ok2 = tok.transfer(b, stake);
            assert_transfer_ok(ok2);
            self.emit(Event::WagerRefunded(WagerRefunded { wager_id, to: a, amount: stake }));
            self.emit(Event::WagerRefunded(WagerRefunded { wager_id, to: b, amount: stake }));
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

            let WagerConfig { game_adapter, token, stake, deadlines, game_params, designated_opponent } =
                config;
            let zero: ContractAddress = 0.try_into().unwrap();

            let id = self.next_wager_id.read();
            self.next_wager_id.write(id + 1_u64);

            self.status.write(id, WagerStatus::Open);
            self.creator.write(id, creator);
            self.opponent.write(id, zero);
            self.designated_opponent.write(id, designated_opponent);
            self.game_adapter.write(id, game_adapter);
            self.token.write(id, token);
            self.stake.write(id, stake);
            self.accept_by.write(id, deadlines.accept_by);
            self.resolve_by.write(id, deadlines.resolve_by);
            self.match_adapter.write(id, zero);
            self.match_id.write(id, 0_u64);

            self.write_params(id, game_params);

            self
                .emit(
                    Event::WagerCreated(
                        WagerCreated {
                            wager_id: id,
                            creator,
                            game_adapter,
                            token,
                            stake,
                            accept_by: deadlines.accept_by,
                            resolve_by: deadlines.resolve_by,
                            designated_opponent,
                        },
                    ),
                );

            id
        }

        fn accept(ref self: ContractState, wager_id: u64) {
            self.require_known_wager(wager_id);
            assert(self.status.read(wager_id) == WagerStatus::Open, 'bad_state');
            let creator = self.creator.read(wager_id);
            let opp_old = self.opponent.read(wager_id);
            let zero: ContractAddress = 0.try_into().unwrap();
            assert(opp_old == zero, 'has_opp');

            let caller = get_caller_address();
            assert(caller != creator, 'self_match');
            let designated = self.designated_opponent.read(wager_id);
            if designated != zero {
                assert(caller == designated, 'bad_opponent');
            }
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

            self.emit(Event::WagerAccepted(WagerAccepted { wager_id, opponent: caller, match_id: mr.match_id }));
        }

        fn cancel(ref self: ContractState, wager_id: u64) {
            self.require_known_wager(wager_id);
            assert(self.status.read(wager_id) == WagerStatus::Open, 'bad_state');
            assert(get_caller_address() == self.creator.read(wager_id), 'not_creator');
            let stake = self.stake.read(wager_id);
            let creator = self.creator.read(wager_id);
            self.status.write(wager_id, WagerStatus::Cancelled);
            let tok = self.token_dispatcher(wager_id);
            let ok = tok.transfer(creator, stake);
            assert_transfer_ok(ok);
            self.emit(Event::WagerCancelled(WagerCancelled { wager_id }));
            self.emit(Event::WagerRefunded(WagerRefunded { wager_id, to: creator, amount: stake }));
        }

        fn expire(ref self: ContractState, wager_id: u64) {
            self.require_known_wager(wager_id);
            let st = self.status.read(wager_id);
            let now = get_block_timestamp();
            let stake = self.stake.read(wager_id);
            let creator = self.creator.read(wager_id);
            let opponent = self.opponent.read(wager_id);
            let tok = self.token_dispatcher(wager_id);

            if st == WagerStatus::Open {
                assert(now > self.accept_by.read(wager_id), 'not_expired');
                self.status.write(wager_id, WagerStatus::Expired);
                let ok = tok.transfer(creator, stake);
                assert_transfer_ok(ok);
                self.emit(Event::WagerRefunded(WagerRefunded { wager_id, to: creator, amount: stake }));
                return;
            }

            if st == WagerStatus::Matched {
                assert(now > self.resolve_by.read(wager_id), 'not_expired');
                let ma = self.match_adapter.read(wager_id);
                let mid = self.match_id.read(wager_id);
                let mr = MatchRef { adapter: ma, match_id: mid };
                let adapter = IGameAdapterDispatcher { contract_address: ma };
                let mo = adapter.normalized_outcome(mr);
                self.status.write(wager_id, WagerStatus::Expired);
                match mo {
                    MatchOutcome::None => {
                        self.refund_two(wager_id, creator, opponent, stake);
                    },
                    MatchOutcome::CreatorWin => {
                        self.pay_win(wager_id, creator, stake, mo, true);
                    },
                    MatchOutcome::OpponentWin => {
                        self.pay_win(wager_id, opponent, stake, mo, true);
                    },
                    MatchOutcome::Draw => {
                        self.pay_draw(wager_id, creator, opponent, stake, true);
                    },
                    MatchOutcome::Cancelled => {
                        self.refund_two(wager_id, creator, opponent, stake);
                    },
                    MatchOutcome::Expired => {
                        self.refund_two(wager_id, creator, opponent, stake);
                    },
                }
                return;
            }

            core::panic_with_felt252('bad_state');
        }

        fn resolve(ref self: ContractState, wager_id: u64) -> MatchOutcome {
            self.require_known_wager(wager_id);
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

            match mo {
                MatchOutcome::None => {
                    assert(false, 'no_outcome');
                },
                _ => {},
            }
            self.status.write(wager_id, WagerStatus::Resolved);
            match mo {
                MatchOutcome::None => {
                    assert(false, 'no_outcome');
                },
                MatchOutcome::CreatorWin => {
                    self.pay_win(wager_id, creator, stake, mo, false);
                },
                MatchOutcome::OpponentWin => {
                    self.pay_win(wager_id, opponent, stake, mo, false);
                },
                MatchOutcome::Draw => {
                    self.pay_draw(wager_id, creator, opponent, stake, false);
                },
                MatchOutcome::Cancelled => {
                    self.refund_two(wager_id, creator, opponent, stake);
                },
                MatchOutcome::Expired => {
                    self.refund_two(wager_id, creator, opponent, stake);
                },
            }
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
