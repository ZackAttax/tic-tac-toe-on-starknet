// SPDX-License-Identifier: MIT
//! Minimal ERC20-like contract for tests: `transfer` / `transfer_from` always return `false`.

#[starknet::contract]
pub mod failing_erc20 {
    use starknet::ContractAddress;
    use tic_tac_toe::erc20_interface::IERC20;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl FailingImpl of IERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            0_u256
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            0_u256
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            false
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            false
        }
    }
}
