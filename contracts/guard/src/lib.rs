mod events;
mod owner;
mod parser;
mod policy;
mod storage;
mod types;

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

use events::*;
use owner::*;
use parser::*;
use policy::*;
use storage::*;
use types::*;

const MPC_SIGN_GAS: Gas = Gas::from_tgas(50);
const ON_SIGNED_GAS: Gas = Gas::from_tgas(15);
const GAS_BUFFER: Gas = Gas::from_tgas(10);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Guard {
    mpc_contract: AccountId,
    mpc_domain_id: u32,
    network_tag: String,
    admin: AccountId,
    global_paused: bool,
    vaults: IterableMap<u32, Vault>,
    agent_to_vault: LookupMap<AccountId, u32>,
    owner_nonce: LookupMap<[u8; 32], u64>,
    requests: LookupMap<[u8; 32], SignRequest>,
    next_vault_id: u32,
}

#[near]
impl Guard {
    #[init]
    pub fn new(
        mpc_contract: AccountId,
        mpc_domain_id: u32,
        network_tag: String,
        admin: AccountId,
    ) -> Self {
        Self {
            mpc_contract,
            mpc_domain_id,
            network_tag,
            admin,
            global_paused: false,
            vaults: IterableMap::new(StorageKey::Vaults),
            agent_to_vault: LookupMap::new(StorageKey::AgentToVault),
            owner_nonce: LookupMap::new(StorageKey::OwnerNonce),
            requests: LookupMap::new(StorageKey::Requests),
            next_vault_id: 0,
        }
    }

    pub fn owner_action(&mut self, msg: String, sig: Vec<u8>) -> String {
        self.handle_owner_action(msg, sig)
    }

    pub fn request_sign(&mut self, vault_id: u32, message_b64: String, req_id_b64: String) -> Promise {
        self.process_sign_request(vault_id, message_b64, req_id_b64)
    }

    #[private]
    pub fn on_signed(
        &mut self,
        req_id: [u8; 32],
        #[callback_result] result: Result<MpcSignature, PromiseError>,
    ) -> Option<Vec<u8>> {
        self.handle_signed_callback(req_id, result)
    }

    #[private]
    pub fn on_agent_created(
        &mut self,
        vault_id: u32,
        agent_name: String,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if result.is_ok() {
            if let Some(mut vault) = self.vaults.get(&vault_id) {
                let agent_id: AccountId = format!("{}.{}", agent_name, env::current_account_id())
                    .parse()
                    .unwrap();
                vault.agents.push(agent_id.clone());
                self.vaults.insert(vault_id, vault);
                self.agent_to_vault.insert(agent_id.clone(), vault_id);
                emit_event(Event::AgentAdded {
                    vault_id,
                    agent: agent_id.to_string(),
                });
            }
        }
    }

    pub fn apply_pending_policy(&mut self, vault_id: u32) {
        let mut vault = self.vaults.get(&vault_id).expect("vault not found");
        
        if let Some((pending_policy, effective_ns)) = vault.pending_loosen.take() {
            require!(env::block_timestamp() >= effective_ns, "delay not elapsed");
            vault.policy = pending_policy;
            self.vaults.insert(vault_id, vault);
            emit_event(Event::PolicyChanged { vault_id });
        } else {
            env::panic_str("no pending policy");
        }
    }

    #[payable]
    pub fn admin_pause_all(&mut self, paused: bool) {
        require!(env::predecessor_account_id() == self.admin, "admin only");
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "attach 1 yocto");
        self.global_paused = paused;
    }

    pub fn get_vault(&self, vault_id: u32) -> Option<VaultView> {
        self.vaults.get(&vault_id).map(|v| v.to_view())
    }

    pub fn get_policy(&self, vault_id: u32) -> Option<Policy> {
        self.vaults.get(&vault_id).map(|v| v.policy.clone())
    }

    pub fn get_request(&self, req_id_b64: String) -> Option<SignRequestView> {
        let req_id = base64_decode(&req_id_b64);
        self.requests.get(&req_id).map(|r| r.to_view())
    }

    pub fn get_spend_24h(&self, vault_id: u32) -> Vec<(String, u64)> {
        let vault = self.vaults.get(&vault_id).expect("vault not found");
        let now_hour = env::block_timestamp() / (3600 * 1_000_000_000);
        let mut totals: std::collections::HashMap<Mint, u64> = std::collections::HashMap::new();

        for hour_offset in 0..24 {
            if let Some(hour) = now_hour.checked_sub(hour_offset) {
                if let Some(entries) = vault.buckets.get(&hour) {
                    for (mint, amount) in entries.iter() {
                        *totals.entry(mint.clone()).or_insert(0) += amount;
                    }
                }
            }
        }

        totals
            .into_iter()
            .map(|(m, a)| (mint_to_string(&m), a))
            .collect()
    }

    pub fn list_vaults(&self, from: Option<u32>, limit: Option<u32>) -> Vec<(u32, VaultView)> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;

        self.vaults
            .iter()
            .skip(from as usize)
            .take(limit)
            .map(|(id, v)| (id, v.to_view()))
            .collect()
    }

    pub fn supported_programs(&self) -> Vec<String> {
        SUPPORTED_PROGRAMS
            .iter()
            .map(|p| base58_encode(p))
            .collect()
    }

    pub fn owner_nonce(&self, owner_b58: String) -> u64 {
        let owner = base58_decode(&owner_b58);
        self.owner_nonce.get(&owner).unwrap_or(0)
    }

    fn release_reservation(&mut self, request: &mut SignRequest) {
        if let Some(mut vault) = self.vaults.get(&request.vault_id) {
            if let Some(mut entries) = vault.buckets.get(&request.hour) {
                entries.retain(|(hash, _)| hash != &request.msg_hash);
                vault.buckets.insert(request.hour, entries);
                self.vaults.insert(request.vault_id, vault);
            }
        }
    }
}

macro_rules! require {
    ($cond:expr, $msg:expr) => {
        if !$cond {
            env::panic_str($msg);
        }
    };
}

fn base58_encode(bytes: &[u8]) -> String {
    bs58::encode(bytes).into_string()
}

fn base58_decode(s: &str) -> [u8; 32] {
    let bytes = bs58::decode(s).into_vec().expect("invalid base58");
    bytes.try_into().expect("wrong length")
}

fn base64_decode(s: &str) -> [u8; 32] {
    let bytes = near_sdk::base64::decode(s).expect("invalid base64");
    bytes.try_into().expect("wrong length")
}

fn base64_decode_vec(s: &str) -> Vec<u8> {
    near_sdk::base64::decode(s).expect("invalid base64")
}

fn mint_to_string(mint: &Mint) -> String {
    match mint {
        Mint::Sol => "SOL".to_string(),
        Mint::Spl(bytes) => base58_encode(bytes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base58_roundtrip() {
        let bytes = [1u8; 32];
        let encoded = base58_encode(&bytes);
        let decoded = base58_decode(&encoded);
        assert_eq!(bytes, decoded);
    }

    #[test]
    fn test_init() {
        let contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            "admin.testnet".parse().unwrap(),
        );
        assert_eq!(contract.next_vault_id, 0);
        assert!(!contract.global_paused);
    }
}
