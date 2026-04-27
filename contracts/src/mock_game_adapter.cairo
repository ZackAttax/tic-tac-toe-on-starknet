// SPDX-License-Identifier: MIT
//! Test-only game adapter: deterministic `MatchRef`, stored outcome for `normalized_outcome`.

use tic_tac_toe::protocol::MatchOutcome;

#[starknet::interface]
pub trait IMockAdapterHooks<TContractState> {
    fn test_set_outcome(ref self: TContractState, match_id: u64, outcome: MatchOutcome);
}

#[starknet::contract]
pub mod mock_game_adapter {
    use core::traits::TryInto;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use tic_tac_toe::protocol::{IGameAdapter, MatchOutcome, MatchRef, WagerConfig};

    #[storage]
    struct Storage {
        owner: ContractAddress,
        next_match_id: u64,
        match_creator: Map<u64, ContractAddress>,
        match_opponent: Map<u64, ContractAddress>,
        match_outcome: Map<u64, MatchOutcome>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        let zero: ContractAddress = 0.try_into().unwrap();
        assert(owner != zero, 'zero_owner');
        self.owner.write(owner);
        self.next_match_id.write(1_u64);
    }

    fn require_owner(self: @ContractState) {
        assert(get_caller_address() == self.owner.read(), 'not_owner');
    }

    #[abi(embed_v0)]
    impl AdapterImpl of IGameAdapter<ContractState> {
        fn validate_config(self: @ContractState, config: WagerConfig) -> bool {
            let zero: ContractAddress = 0.try_into().unwrap();
            if config.game_adapter == zero {
                return false;
            }
            if config.token == zero {
                return false;
            }
            if config.stake == 0_u256 {
                return false;
            }
            let now = get_block_timestamp();
            if config.deadlines.accept_by <= now {
                return false;
            }
            if config.deadlines.resolve_by <= config.deadlines.accept_by {
                return false;
            }
            true
        }

        fn create_match(
            ref self: ContractState,
            creator: ContractAddress,
            opponent: ContractAddress,
            config: WagerConfig,
        ) -> MatchRef {
            assert(creator != opponent, 'same_p');
            let id = self.next_match_id.read();
            self.next_match_id.write(id + 1_u64);
            self.match_creator.write(id, creator);
            self.match_opponent.write(id, opponent);
            self.match_outcome.write(id, MatchOutcome::None);
            assert(config.game_adapter == get_contract_address(), 'adapter_addr');
            MatchRef { adapter: get_contract_address(), match_id: id }
        }

        fn normalized_participants(
            self: @ContractState, match_ref: MatchRef,
        ) -> (ContractAddress, ContractAddress) {
            assert(match_ref.adapter == get_contract_address(), 'bad_adapt');
            (
                self.match_creator.read(match_ref.match_id),
                self.match_opponent.read(match_ref.match_id),
            )
        }

        fn normalized_outcome(self: @ContractState, match_ref: MatchRef) -> MatchOutcome {
            assert(match_ref.adapter == get_contract_address(), 'bad_adapt');
            self.match_outcome.read(match_ref.match_id)
        }
    }

    #[abi(embed_v0)]
    impl HooksImpl of super::IMockAdapterHooks<ContractState> {
        fn test_set_outcome(ref self: ContractState, match_id: u64, outcome: MatchOutcome) {
            require_owner(@self);
            self.match_outcome.write(match_id, outcome);
        }
    }
}
