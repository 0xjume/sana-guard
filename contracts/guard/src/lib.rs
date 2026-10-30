mod events;
mod legacy;
mod owner;
mod parser;
mod policy;
mod storage;
mod types;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod tests_comprehensive;

#[cfg(test)]
mod tests_fuzz;

#[cfg(test)]
mod tests_policy_comprehensive;

#[cfg(test)]
mod tests_callback;

#[cfg(test)]
mod tests_admin_signatures;

#[cfg(test)]
mod tests_e2e_fixes;

#[cfg(test)]
mod tests_release_and_programs;

#[cfg(test)]
mod tests_followup_f1_f4;

#[cfg(test)]
mod tests_migration;
#[cfg(test)]
mod tests_refund_bugs;

#[cfg(test)]
mod test_helpers;

#[cfg(test)]
mod tests_sdk_admin_fixtures;

use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

use events::*;
use parser::*;
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
    owner_vault_count: LookupMap<[u8; 32], u32>,
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
            owner_vault_count: LookupMap::new(StorageKey::OwnerVaultCount),
        }
    }

    #[init(ignore_state)]
    #[private]
    pub fn migrate() -> Self {
        use crate::legacy::OldGuard;

        let old: OldGuard = env::state_read().expect("state not found");

        // Migrate vaults from 014ea08 (PR #2) to current version
        // Changes: add state (default Active), add max_total_priority_fee_lamports (default None),
        // add recipients_list (empty, needs backfill_recipients call)
        let mut old_vaults = old.vaults;
        let mut new_vaults = IterableMap::new(StorageKey::Vaults);

        // Old and new maps share StorageKey::Vaults. Drain the old entries into memory and
        // flush the deletions to storage BEFORE inserting: IterableMap::insert reads the
        // existing value at that key (to return it) and would try to decode OldVault bytes
        // as the new Vault -> "Cannot deserialize element".
        let old_entries: Vec<(u32, crate::legacy::OldVault)> = old_vaults.drain().collect();
        old_vaults.flush();
        drop(old_vaults);

        for (vault_id, old_vault) in old_entries {
            // Convert old policy to new policy
            let new_policy = Policy {
                per_tx_limit: old_vault.policy.per_tx_limit,
                daily_cap: old_vault.policy.daily_cap,
                programs: old_vault.policy.programs,
                max_priority_fee_lamports: old_vault.policy.max_priority_fee_lamports,
                max_total_priority_fee_lamports: None, // New field, default to None
                max_memo_len: old_vault.policy.max_memo_len,
                expires_at_ns: old_vault.policy.expires_at_ns,
                loosen_delay_ns: old_vault.policy.loosen_delay_ns,
            };

            // Convert pending_loosen if it exists
            let pending_loosen = old_vault.pending_loosen.map(|(old_pol, ts)| {
                let new_pol = Policy {
                    per_tx_limit: old_pol.per_tx_limit,
                    daily_cap: old_pol.daily_cap,
                    programs: old_pol.programs,
                    max_priority_fee_lamports: old_pol.max_priority_fee_lamports,
                    max_total_priority_fee_lamports: None,
                    max_memo_len: old_pol.max_memo_len,
                    expires_at_ns: old_pol.expires_at_ns,
                    loosen_delay_ns: old_pol.loosen_delay_ns,
                };
                (new_pol, ts)
            });

            let new_vault = Vault {
                owner: old_vault.owner,
                vault_address: old_vault.vault_address,
                path: old_vault.path,
                state: VaultState::Active, // All existing vaults are active
                agents: old_vault.agents,
                policy: new_policy,
                pending_loosen,
                recipients: old_vault.recipients,
                recipients_list: Vec::new(), // Empty, needs backfill_recipients call
                programs: old_vault.programs,
                token_accounts: old_vault.token_accounts,
                bucket_hashes: old_vault.bucket_hashes,
                bucket_spend: old_vault.bucket_spend,
                spent_cursor: old_vault.spent_cursor,
                paused: old_vault.paused,
            };

            new_vaults.insert(vault_id, new_vault);
        }

        Self {
            mpc_contract: old.mpc_contract,
            mpc_domain_id: old.mpc_domain_id,
            network_tag: old.network_tag,
            admin: old.admin,
            global_paused: old.global_paused,
            vaults: new_vaults,
            agent_to_vault: old.agent_to_vault,
            owner_nonce: old.owner_nonce,
            requests: old.requests,
            next_vault_id: old.next_vault_id,
            owner_vault_count: old.owner_vault_count,
        }
    }

    #[payable]
    pub fn owner_action(&mut self, msg: String, sig: Vec<u8>) -> String {
        self.handle_owner_action(msg, sig)
    }

    pub fn request_sign(
        &mut self,
        vault_id: u32,
        message_b64: String,
        req_id_hex: String,
    ) -> Promise {
        self.process_sign_request(vault_id, message_b64, req_id_hex)
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
        original_caller: AccountId,
        deposit_amount: NearToken,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        let agent_id: AccountId = format!("{}.{}", agent_name, env::current_account_id())
            .parse()
            .unwrap();

        if result.is_ok() {
            if let Some(vault) = self.vaults.get_mut(&vault_id) {
                vault.agents.push(agent_id.clone());
                self.agent_to_vault.insert(agent_id.clone(), vault_id);
                emit_event(Event::AgentAdded {
                    vault_id,
                    agent: agent_id.to_string(),
                });
            }
        } else {
            // Nothing is written before success. Do not touch vault.agents or
            // agent_to_vault: a failed create_account for a name that is already
            // live (or belongs to another vault) must not unregister it.
            env::log_str(&format!(
                "agent creation failed for {}, refunding deposit",
                agent_name
            ));
            #[allow(unused_must_use)]
            {
                Promise::new(original_caller).transfer(deposit_amount);
            }
        }
    }

    #[private]
    pub fn on_vault_verified(
        &mut self,
        vault_id: u32,
        original_caller: AccountId,
        deposit_amount: NearToken,
        #[callback_result] result: Result<String, PromiseError>,
    ) {
        let vault = match self.vaults.get_mut(&vault_id) {
            Some(v) => v,
            None => {
                env::log_str(&format!("vault {} not found for verification", vault_id));
                #[allow(unused_must_use)]
                {
                    Promise::new(original_caller).transfer(deposit_amount);
                }
                return;
            }
        };

        match result {
            Ok(derived_key_b58) => {
                match try_base58_decode(&derived_key_b58) {
                    Some(derived_key_bytes) if derived_key_bytes == vault.vault_address => {
                        vault.state = VaultState::Active;
                        emit_event(Event::VaultCreated {
                            vault_id,
                            owner: base58_encode(&vault.owner),
                            vault_address: base58_encode(&vault.vault_address),
                        });
                    }
                    _ => {
                        // Mismatch or undecodable key: remove vault and refund.
                        env::log_str(&format!(
                            "vault address mismatch: expected {} got {}",
                            base58_encode(&vault.vault_address),
                            derived_key_b58
                        ));
                        self.vaults.remove(&vault_id);
                        emit_event(Event::VaultVerificationFailed {
                            vault_id,
                            reason: "address_mismatch".to_string(),
                        });
                        #[allow(unused_must_use)]
                        {
                            Promise::new(original_caller).transfer(deposit_amount);
                        }
                    }
                }
            }
            Err(e) => {
                env::log_str(&format!("MPC call failed: {:?}", e));
                self.vaults.remove(&vault_id);
                emit_event(Event::VaultVerificationFailed {
                    vault_id,
                    reason: "mpc_call_failed".to_string(),
                });
                #[allow(unused_must_use)]
                {
                    Promise::new(original_caller).transfer(deposit_amount);
                }
            }
        }
    }

    pub fn apply_pending_policy(&mut self, vault_id: u32) {
        let vault = self.vaults.get_mut(&vault_id).expect("vault not found");

        if let Some((pending_policy, effective_ns)) = vault.pending_loosen.take() {
            if env::block_timestamp() < effective_ns {
                env::panic_str("delay not elapsed");
            }
            vault.policy = pending_policy;
            emit_event(Event::PolicyChanged { vault_id });
        } else {
            env::panic_str("no pending policy");
        }
    }

    #[payable]
    pub fn admin_pause_all(&mut self, paused: bool) {
        if env::predecessor_account_id() != self.admin {
            env::panic_str("admin only");
        }
        if env::attached_deposit() != NearToken::from_yoctonear(1) {
            env::panic_str("attach 1 yocto");
        }
        self.global_paused = paused;
    }

    pub fn get_vault(&self, vault_id: u32) -> Option<VaultView> {
        self.vaults.get(&vault_id).map(|v| v.to_view())
    }

    pub fn get_policy(&self, vault_id: u32) -> Option<Policy> {
        self.vaults.get(&vault_id).map(|v| v.policy.clone())
    }

    pub fn get_request(&self, req_id_hex: String) -> Option<SignRequestView> {
        let req_id_bytes = hex::decode(&req_id_hex).ok()?;
        if req_id_bytes.len() != 32 {
            return None;
        }
        let mut req_id = [0u8; 32];
        req_id.copy_from_slice(&req_id_bytes);
        self.requests.get(&req_id).map(|r| r.to_view())
    }

    pub fn get_spend_24h(&self, vault_id: u32) -> Vec<(String, u64)> {
        let vault = self.vaults.get(&vault_id).expect("vault not found");
        let now_hour = env::block_timestamp() / (3600 * 1_000_000_000);
        let mut totals: std::collections::HashMap<Mint, u64> = std::collections::HashMap::new();

        for hour_offset in 0..24 {
            if let Some(hour) = now_hour.checked_sub(hour_offset) {
                if let Some(entries) = vault.bucket_spend.get(&hour) {
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

    pub fn get_recipients(
        &self,
        vault_id: u32,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<String> {
        let vault = self.vaults.get(&vault_id).expect("vault not found");
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(50).min(100) as usize;

        vault
            .recipients_list
            .iter()
            .skip(from)
            .take(limit)
            .map(|r| base58_encode(r))
            .collect()
    }

    pub fn list_vaults(&self, from: Option<u32>, limit: Option<u32>) -> Vec<(u32, VaultView)> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;

        self.vaults
            .iter()
            .skip(from as usize)
            .take(limit)
            .map(|(id, v)| (*id, v.to_view()))
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
        self.owner_nonce.get(&owner).copied().unwrap_or(0)
    }

    fn release_reservation(&mut self, request: &SignRequest) {
        if let Some(vault) = self.vaults.get_mut(&request.vault_id) {
            // Remove hash marker
            if let Some(hashes) = vault.bucket_hashes.get(&request.hour) {
                let mut new_hashes = hashes.clone();
                new_hashes.retain(|hash| hash != &request.msg_hash);
                vault.bucket_hashes.insert(request.hour, new_hashes);
            }

            // Subtract spend amounts
            if let Some(spend_entries) = vault.bucket_spend.get(&request.hour) {
                let mut new_spend = spend_entries.clone();

                for (req_mint, req_amount) in &request.spend {
                    if let Some((_, existing_amount)) =
                        new_spend.iter_mut().find(|(mint, _)| mint == req_mint)
                    {
                        *existing_amount = existing_amount.saturating_sub(*req_amount);
                    }
                }

                vault.bucket_spend.insert(request.hour, new_spend);
            }
        }
    }
}

/// Records `msg_hash` and adds `spend` to the vault's bucket for `hour`.
/// Inverse of `Guard::release_reservation`.
fn reserve_spend(vault: &mut Vault, hour: u64, msg_hash: &[u8; 32], spend: &[(Mint, u64)]) {
    // Add message hash to prevent replays
    let mut hashes = vault.bucket_hashes.get(&hour).cloned().unwrap_or_default();
    hashes.push(*msg_hash);
    vault.bucket_hashes.insert(hour, hashes);

    // Add spend amounts
    let mut spend_entries = vault.bucket_spend.get(&hour).cloned().unwrap_or_default();
    for (mint, amount) in spend {
        match spend_entries.iter_mut().find(|(m, _)| m == mint) {
            Some((_, existing_amount)) => {
                *existing_amount = existing_amount.checked_add(*amount).unwrap_or(u64::MAX);
            }
            None => spend_entries.push((mint.clone(), *amount)),
        }
    }
    vault.bucket_spend.insert(hour, spend_entries);
}

fn base58_encode(bytes: &[u8]) -> String {
    bs58::encode(bytes).into_string()
}

fn try_base58_decode(s: &str) -> Option<[u8; 32]> {
    let bytes = bs58::decode(s).into_vec().ok()?;
    bytes.try_into().ok()
}

fn base58_decode(s: &str) -> [u8; 32] {
    try_base58_decode(s).expect("invalid base58")
}

#[allow(dead_code)]
pub fn base64_decode(s: &str) -> [u8; 32] {
    use near_sdk::base64::engine::general_purpose::STANDARD;
    use near_sdk::base64::Engine;
    let bytes = STANDARD.decode(s).expect("invalid base64");
    bytes.try_into().expect("wrong length")
}

// Private helper methods (not exported via NEAR ABI)
impl Guard {
    /// Backfill recipients_list from recipients LookupSet for migrated vaults.
    /// Can only add recipients that are already in the LookupSet (no new recipients).
    /// PRIVATE: Only callable via owner-signed BackfillRecipients action.
    pub(crate) fn backfill_recipients(
        &mut self,
        vault_id: u32,
        recipients_b58: Vec<String>,
    ) -> String {
        let mut vault = self.vaults.remove(&vault_id).expect("vault not found");

        let mut added = 0;
        let mut skipped = 0;

        for recipient_b58 in recipients_b58 {
            let recipient = base58_decode(&recipient_b58);

            // Only add if it's in the LookupSet (existing recipient)
            if vault.recipients.contains(&recipient) {
                // Check if not already in list
                if !vault.recipients_list.contains(&recipient) {
                    vault.recipients_list.push(recipient);
                    added += 1;
                } else {
                    skipped += 1;
                }
            } else {
                skipped += 1;
            }
        }

        self.vaults.insert(vault_id, vault);
        format!("backfilled {} recipients, skipped {}", added, skipped)
    }
}

fn base64_decode_vec(s: &str) -> Vec<u8> {
    use near_sdk::base64::engine::general_purpose::STANDARD;
    use near_sdk::base64::Engine;
    STANDARD.decode(s).expect("invalid base64")
}

fn mint_to_string(mint: &Mint) -> String {
    match mint {
        Mint::Sol => "SOL".to_string(),
        Mint::Spl(bytes) => base58_encode(bytes),
    }
}
