use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{json_types::U64, AccountId};

use crate::storage::StorageKey;

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, PartialEq, Eq, Hash)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum Mint {
    Sol,
    Spl([u8; 32]),
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, PartialEq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum VaultState {
    PendingVerification,
    Active,
}

#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Vault {
    pub owner: [u8; 32],
    pub vault_address: [u8; 32],
    pub path: String,
    pub state: VaultState,
    pub agents: Vec<AccountId>,
    pub policy: Policy,
    pub pending_loosen: Option<(Policy, u64)>,
    pub recipients: LookupSet<[u8; 32]>,
    pub recipients_list: Vec<[u8; 32]>, // F4: For iteration/pagination
    pub programs: LookupSet<[u8; 32]>,
    pub token_accounts: LookupMap<[u8; 32], ([u8; 32], u8)>,
    pub bucket_hashes: LookupMap<u64, Vec<[u8; 32]>>,
    pub bucket_spend: LookupMap<u64, Vec<(Mint, u64)>>,
    pub spent_cursor: u64,
    pub paused: bool,
}

impl Vault {
    pub fn new(
        vault_id: u32,
        owner: [u8; 32],
        vault_address: [u8; 32],
        path: String,
        policy: Policy,
    ) -> Self {
        Self {
            owner,
            vault_address,
            path,
            state: VaultState::PendingVerification,
            agents: Vec::new(),
            policy,
            pending_loosen: None,
            recipients: LookupSet::new(StorageKey::Recipients { vault: vault_id }),
            recipients_list: Vec::new(),
            programs: LookupSet::new(StorageKey::Programs { vault: vault_id }),
            token_accounts: LookupMap::new(StorageKey::TokenAccts { vault: vault_id }),
            bucket_hashes: LookupMap::new(StorageKey::BucketHashes { vault: vault_id }),
            bucket_spend: LookupMap::new(StorageKey::BucketSpend { vault: vault_id }),
            spent_cursor: 0,
            paused: false,
        }
    }

    pub fn to_view(&self) -> VaultView {
        VaultView {
            owner: crate::base58_encode(&self.owner),
            vault_address: crate::base58_encode(&self.vault_address),
            path: self.path.clone(),
            state: self.state.clone(),
            agents: self.agents.clone(),
            policy: self.policy.clone(),
            pending_loosen: self
                .pending_loosen
                .as_ref()
                .map(|(p, ns)| PendingLoosenView {
                    policy: p.clone(),
                    effective_ns: U64(*ns),
                }),
            paused: self.paused,
        }
    }
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Policy {
    pub per_tx_limit: Vec<(Mint, U64)>,
    pub daily_cap: Vec<(Mint, U64)>,
    pub programs: Vec<String>,
    pub max_priority_fee_lamports: U64,
    pub max_total_priority_fee_lamports: Option<U64>,
    pub max_memo_len: u16,
    pub expires_at_ns: U64,
    pub loosen_delay_ns: U64,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct VaultView {
    pub owner: String,
    pub vault_address: String,
    pub path: String,
    pub state: VaultState,
    pub agents: Vec<AccountId>,
    pub policy: Policy,
    pub pending_loosen: Option<PendingLoosenView>,
    pub paused: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PendingLoosenView {
    pub policy: Policy,
    pub effective_ns: U64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
#[serde(tag = "status")]
pub enum Status {
    Pending,
    Signed,
    Failed,
    Released,
}

#[derive(BorshSerialize, BorshDeserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct SignRequest {
    pub vault_id: u32,
    pub agent: AccountId,
    pub msg_hash: [u8; 32],
    pub spend: Vec<(Mint, u64)>,
    pub hour: u64,
    pub status: Status,
    pub signature: Option<Vec<u8>>,
    pub created_ns: u64,
}

impl SignRequest {
    pub fn to_view(&self) -> SignRequestView {
        SignRequestView {
            vault_id: self.vault_id,
            agent: self.agent.clone(),
            msg_hash: crate::base58_encode(&self.msg_hash),
            spend: self
                .spend
                .iter()
                .map(|(m, a)| (crate::mint_to_string(m), U64(*a)))
                .collect(),
            hour: self.hour,
            status: self.status.clone(),
            signature: self.signature.as_ref().map(|s| {
                use near_sdk::base64::engine::general_purpose::STANDARD;
                use near_sdk::base64::Engine;
                STANDARD.encode(s)
            }),
            created_ns: U64(self.created_ns),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SignRequestView {
    pub vault_id: u32,
    pub agent: AccountId,
    pub msg_hash: String,
    pub spend: Vec<(String, U64)>,
    pub hour: u64,
    pub status: Status,
    pub signature: Option<String>,
    pub created_ns: U64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[serde(tag = "scheme")]
pub enum MpcSignature {
    Ed25519 { signature: Vec<u8> },
}
