// Legacy type definitions for migration from commit 014ea08 (PR #2)
// DO NOT MODIFY - these must match the exact borsh layout at that commit

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{AccountId, json_types::U64};

use crate::types::{Mint, SignRequest, Status};

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct OldPolicy {
    pub per_tx_limit: Vec<(Mint, U64)>,
    pub daily_cap: Vec<(Mint, U64)>,
    pub programs: Vec<String>,
    pub max_priority_fee_lamports: U64,
    pub max_memo_len: u16,
    pub expires_at_ns: U64,
    pub loosen_delay_ns: U64,
}

#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct OldVault {
    pub owner: [u8; 32],
    pub vault_address: [u8; 32],
    pub path: String,
    pub agents: Vec<AccountId>,
    pub policy: OldPolicy,
    pub pending_loosen: Option<(OldPolicy, u64)>,
    pub recipients: LookupSet<[u8; 32]>,
    pub programs: LookupSet<[u8; 32]>,
    pub token_accounts: LookupMap<[u8; 32], ([u8; 32], u8)>,
    pub bucket_hashes: LookupMap<u64, Vec<[u8; 32]>>,
    pub bucket_spend: LookupMap<u64, Vec<(Mint, u64)>>,
    pub spent_cursor: u64,
    pub paused: bool,
}

#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct OldGuard {
    pub mpc_contract: AccountId,
    pub mpc_domain_id: u32,
    pub network_tag: String,
    pub admin: AccountId,
    pub global_paused: bool,
    pub vaults: IterableMap<u32, OldVault>,
    pub agent_to_vault: LookupMap<AccountId, u32>,
    pub owner_nonce: LookupMap<[u8; 32], u64>,
    pub requests: LookupMap<[u8; 32], SignRequest>,
    pub next_vault_id: u32,
    pub owner_vault_count: LookupMap<[u8; 32], u32>,
}
