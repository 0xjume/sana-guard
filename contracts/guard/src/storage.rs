use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::BorshStorageKey;

#[derive(BorshStorageKey, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
pub enum StorageKey {
    Vaults,
    AgentToVault,
    Requests,
    OwnerNonce,
    Recipients { vault: u32 },
    Programs { vault: u32 },
    Mints { vault: u32 },
    TokenAccts { vault: u32 },
    Buckets { vault: u32 },
}
