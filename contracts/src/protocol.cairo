// SPDX-License-Identifier: MIT
//! Shared wager protocol types and interfaces (game-agnostic).
//!
//! **Stable import path:** consume types and traits from `tic_tac_toe::protocol` (e.g.
//! `tic_tac_toe::protocol::WagerConfig`, `tic_tac_toe::protocol::IWagerEscrow`).
//!
//! ## ERC20 / escrow v1 assumptions
//!
//! The reference escrow in this repo (`wager_escrow`) enforces a **single approved token** at
//! deployment and treats **token decimals as a display concern** off-chain. **Fee-on-transfer**,
//! **rebasing**, and other balance-manipulating or non-standard ERC20 behaviors are **unsupported**:
//! stakes and payouts are accounted in raw `u256` amounts; misbehaving tokens can cause stuck funds
//! or incorrect settlement.
//!
//! ## Adapter address invariant (`game_adapter` vs `MatchRef.adapter`)
//!
//! `WagerConfig.game_adapter` is the **authoritative** adapter contract for the wager: it is chosen
//! at creation and stored in the immutable config snapshot.
//!
//! When a match exists, `MatchRef.adapter` identifies which contract owns `match_id`. **They must
//! agree:** for any wager where `match_ref` is set to an active match (non-zero adapter),
//! **`match_ref.adapter` MUST equal `config.game_adapter`**. There is no separate “two valid
//! adapters” interpretation—if they differ, the record is invalid.
//!
//! **Enforcement:** escrow **MUST** reject or normalize any `MatchRef` from
//! `IGameAdapter::create_match`
//! where `adapter != config.game_adapter` before persisting. Adapters **SHOULD** set
//! `MatchRef.adapter` to `get_contract_address()` when returning from `create_match`. Clients
//! resolving outcomes or participants **SHOULD** dispatch to `match_ref.adapter` (equal to
//! `game_adapter` when the invariant holds).

use starknet::ContractAddress;

/// Normalized match outcome for escrow settlement (adapter is source of truth).
#[derive(Copy, Drop, Serde, starknet::Store, PartialEq)]
#[allow(starknet::store_no_default_variant)]
pub enum MatchOutcome {
    None,
    CreatorWin,
    OpponentWin,
    Draw,
    Cancelled,
    Expired,
}

/// Lifecycle state of a wager held by escrow.
#[derive(Copy, Drop, Serde, starknet::Store, PartialEq)]
#[allow(starknet::store_no_default_variant)]
pub enum WagerStatus {
    Open,
    Matched,
    Resolved,
    Cancelled,
    Expired,
}

/// Handle to a match inside a specific game adapter contract.
#[derive(Copy, Drop, Serde)]
pub struct MatchRef {
    /// Contract that owns `match_id`; MUST equal `WagerConfig.game_adapter` when the match is live
    /// (see module docs).
    pub adapter: ContractAddress,
    pub match_id: u64,
}

/// Acceptance and resolution windows (Starknet block timestamps).
#[derive(Copy, Drop, Serde)]
pub struct WagerDeadlines {
    pub accept_by: u64,
    pub resolve_by: u64,
}

/// Immutable configuration supplied at wager creation (includes deadlines).
#[derive(Drop, Serde)]
pub struct WagerConfig {
    /// Authoritative adapter for this wager; `MatchRef.adapter` MUST match when a match is set (see
    /// module docs).
    pub game_adapter: ContractAddress,
    /// ERC-20 token used for stakes; must be non-zero and must equal the escrow `approved_token`
    /// for this codebase’s escrow (v1 single-token policy). Fee-on-transfer / rebasing unsupported.
    pub token: ContractAddress,
    pub stake: u256,
    pub deadlines: WagerDeadlines,
    pub game_params: Array<felt252>,
}

/// Snapshot of a wager as exposed by escrow getters.
#[derive(Drop, Serde)]
pub struct WagerRecord {
    pub wager_id: u64,
    pub status: WagerStatus,
    pub config: WagerConfig,
    pub creator: ContractAddress,
    pub opponent: ContractAddress,
    pub match_ref: MatchRef,
}

/// Validates game params, creates matches, and exposes normalized participants/outcomes.
#[starknet::interface]
pub trait IGameAdapter<TContractState> {
    fn validate_config(self: @TContractState, config: WagerConfig) -> bool;
    fn create_match(
        ref self: TContractState,
        creator: ContractAddress,
        opponent: ContractAddress,
        config: WagerConfig,
    ) -> MatchRef;
    fn normalized_participants(
        self: @TContractState, match_ref: MatchRef,
    ) -> (ContractAddress, ContractAddress);
    fn normalized_outcome(self: @TContractState, match_ref: MatchRef) -> MatchOutcome;
}

/// Escrow lifecycle for wagers; resolves by reading the adapter (no trusted outcome calldata).
#[starknet::interface]
pub trait IWagerEscrow<TContractState> {
    fn create(ref self: TContractState, config: WagerConfig) -> u64;
    fn accept(ref self: TContractState, wager_id: u64);
    fn cancel(ref self: TContractState, wager_id: u64);
    fn expire(ref self: TContractState, wager_id: u64);
    fn resolve(ref self: TContractState, wager_id: u64) -> MatchOutcome;
    fn get_wager(self: @TContractState, wager_id: u64) -> WagerRecord;
    fn get_status(self: @TContractState, wager_id: u64) -> WagerStatus;
}
