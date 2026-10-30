use crate::events::*;
use crate::parser::decode_policy_programs;
use crate::types::*;
use crate::{base58_decode, base58_encode, Guard};
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{env, AccountId, Allowance, Gas, NearToken, Promise};

const MIN_AGENT_FUNDING: u128 = 2_500_000_000_000_000_000_000; // 0.0025 NEAR
const MAX_AGENT_FUNDING: u128 = 500_000_000_000_000_000_000_000; // 0.5 NEAR
const AGENT_ACCESS_KEY_ALLOWANCE: u128 = 250_000_000_000_000_000_000_000; // 0.25 NEAR

// Approximate storage costs in yoctoNEAR (at 10^19 yocto per byte)
const VAULT_STORAGE_COST: u128 = 500_000_000_000_000_000_000_000; // ~0.5 NEAR for vault storage
const AGENT_STORAGE_OVERHEAD: u128 = 50_000_000_000_000_000_000_000; // ~0.05 NEAR overhead

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[serde(tag = "type")]
pub enum OwnerAction {
    CreateVault {
        owner: String,
        vault_address: String,
        policy: Policy,
    },
    AddAgent {
        vault_id: u32,
        name: String,
        public_key: near_sdk::PublicKey,
        gas_funding: U128,
    },
    RemoveAgent {
        vault_id: u32,
        agent: AccountId,
    },
    SetPolicy {
        vault_id: u32,
        policy: Policy,
    },
    AddRecipient {
        vault_id: u32,
        recipient: String,
    },
    RemoveRecipient {
        vault_id: u32,
        recipient: String,
    },
    RegisterTokenAccount {
        vault_id: u32,
        ata: String,
        mint: String,
        decimals: u8,
    },
    Pause {
        vault_id: u32,
    },
    Unpause {
        vault_id: u32,
    },
    Release {
        vault_id: u32,
        req_id: String,
    },
}

struct AdminMessage {
    network: String,
    contract: AccountId,
    #[allow(dead_code)]
    vault: Option<u32>,
    nonce: u64,
    expires: u64,
    action: OwnerAction,
}

impl Guard {
    pub fn handle_owner_action(&mut self, msg: String, sig: Vec<u8>) -> String {
        let parsed = Self::parse_admin_message(&msg).expect("invalid admin message");

        if parsed.network != self.network_tag {
            env::panic_str("wrong network");
        }

        if parsed.contract != env::current_account_id() {
            env::panic_str("wrong contract");
        }

        if env::block_timestamp() > parsed.expires {
            env::panic_str("message expired");
        }

        if sig.len() != 64 {
            env::panic_str("invalid signature length");
        }

        let mut sig_arr = [0u8; 64];
        sig_arr.copy_from_slice(&sig);

        let owner_pubkey = Self::extract_owner_from_action(&parsed.action, self);

        if !env::ed25519_verify(&sig_arr, msg.as_bytes(), &owner_pubkey) {
            env::panic_str("invalid signature");
        }

        let last_nonce = self.owner_nonce.get(&owner_pubkey).copied().unwrap_or(0);
        if parsed.nonce <= last_nonce {
            env::panic_str("nonce too old");
        }

        // Check vault header against action's vault_id
        match &parsed.action {
            OwnerAction::CreateVault { .. } => {
                if parsed.vault.is_some() {
                    env::panic_str("vault must be null for CreateVault");
                }
            }
            _ => {
                let vault_id = Self::vault_id_from_action(&parsed.action);
                if parsed.vault != Some(vault_id) {
                    env::panic_str("vault header mismatch");
                }
            }
        }

        // Validate attached deposit for actions that consume contract resources
        let attached = env::attached_deposit().as_yoctonear();
        let required = Self::calculate_required_deposit(&parsed.action);

        if attached < required {
            env::panic_str("insufficient attached deposit");
        }

        // Refund excess deposit
        if attached > required {
            let refund = attached - required;
            let _ = Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(refund));
        }

        self.owner_nonce.insert(owner_pubkey, parsed.nonce);

        self.execute_owner_action(owner_pubkey, parsed.action)
    }

    fn calculate_required_deposit(action: &OwnerAction) -> u128 {
        match action {
            OwnerAction::CreateVault { .. } => VAULT_STORAGE_COST,
            OwnerAction::AddAgent { gas_funding, .. } => gas_funding.0 + AGENT_STORAGE_OVERHEAD,
            _ => 0,
        }
    }

    fn parse_admin_message(msg: &str) -> Result<AdminMessage, &'static str> {
        let lines: Vec<&str> = msg.lines().collect();

        if lines.len() < 7 {
            return Err("too few lines");
        }

        if lines[0] != "SANA-GUARD-ADMIN-v1" {
            return Err("wrong header");
        }

        let network = lines[1]
            .strip_prefix("network: ")
            .ok_or("missing network")?
            .to_string();
        let contract = lines[2]
            .strip_prefix("contract: ")
            .ok_or("missing contract")?
            .parse()
            .map_err(|_| "invalid contract")?;

        let vault_line = lines[3].strip_prefix("vault: ").ok_or("missing vault")?;
        let vault = if vault_line == "null" {
            None
        } else {
            Some(vault_line.parse().map_err(|_| "invalid vault")?)
        };

        let nonce: u64 = lines[4]
            .strip_prefix("nonce: ")
            .ok_or("missing nonce")?
            .parse()
            .map_err(|_| "invalid nonce")?;

        let expires: u64 = lines[5]
            .strip_prefix("expires: ")
            .ok_or("missing expires")?
            .parse()
            .map_err(|_| "invalid expires")?;

        let action_json = lines[6].strip_prefix("action: ").ok_or("missing action")?;

        let action: OwnerAction =
            serde_json::from_str(action_json).map_err(|_| "invalid action json")?;

        if lines.len() > 7 {
            return Err("extra lines");
        }

        Ok(AdminMessage {
            network,
            contract,
            vault,
            nonce,
            expires,
            action,
        })
    }

    fn extract_owner_from_action(action: &OwnerAction, guard: &Guard) -> [u8; 32] {
        match action {
            OwnerAction::CreateVault { owner, .. } => base58_decode(owner),
            _ => {
                let vault_id = Self::vault_id_from_action(action);
                let vault = guard.vaults.get(&vault_id).expect("vault not found");
                vault.owner
            }
        }
    }

    fn vault_id_from_action(action: &OwnerAction) -> u32 {
        match action {
            OwnerAction::CreateVault { .. } => panic!("CreateVault has no vault_id"),
            OwnerAction::AddAgent { vault_id, .. } => *vault_id,
            OwnerAction::RemoveAgent { vault_id, .. } => *vault_id,
            OwnerAction::SetPolicy { vault_id, .. } => *vault_id,
            OwnerAction::AddRecipient { vault_id, .. } => *vault_id,
            OwnerAction::RemoveRecipient { vault_id, .. } => *vault_id,
            OwnerAction::RegisterTokenAccount { vault_id, .. } => *vault_id,
            OwnerAction::Pause { vault_id } => *vault_id,
            OwnerAction::Unpause { vault_id } => *vault_id,
            OwnerAction::Release { vault_id, .. } => *vault_id,
        }
    }

    pub(crate) fn execute_owner_action(&mut self, owner: [u8; 32], action: OwnerAction) -> String {
        match action {
            OwnerAction::CreateVault {
                owner: owner_str,
                vault_address,
                policy,
            } => {
                let vault_id = self.next_vault_id;
                self.next_vault_id += 1;

                let vault_address_bytes = base58_decode(&vault_address);
                let owner_b58 = base58_encode(&owner);
                Self::validate_policy(&policy);

                if owner_str != owner_b58 {
                    env::panic_str("owner field must match signature");
                }

                let owner_index = self.owner_vault_count.get(&owner).copied().unwrap_or(0);
                self.owner_vault_count.insert(owner, owner_index + 1);

                let path = format!("vault/{}/{}", owner_b58, owner_index);

                let vault = Vault::new(vault_id, owner, vault_address_bytes, path, policy);
                self.vaults.insert(vault_id, vault);

                emit_event(Event::VaultCreated {
                    vault_id,
                    owner: owner_b58,
                    vault_address,
                });

                format!("vault {} created", vault_id)
            }
            OwnerAction::AddAgent {
                vault_id,
                name,
                public_key,
                gas_funding,
            } => {
                let vault = self.vaults.get(&vault_id).expect("vault not found");
                if vault.owner != owner {
                    env::panic_str("not owner");
                }

                if vault.agents.len() >= 8 {
                    env::panic_str("too many agents");
                }

                let funding = gas_funding.0;
                if funding < MIN_AGENT_FUNDING {
                    env::panic_str("gas_funding below minimum");
                }
                if funding > MAX_AGENT_FUNDING {
                    env::panic_str("gas_funding above maximum");
                }

                let agent_id: AccountId = format!("{}.{}", name, env::current_account_id())
                    .parse()
                    .expect("invalid agent name");

                let _ = Promise::new(agent_id.clone())
                    .create_account()
                    .transfer(NearToken::from_yoctonear(funding))
                    .add_access_key_allowance(
                        public_key,
                        Allowance::Limited(
                            std::num::NonZeroU128::new(AGENT_ACCESS_KEY_ALLOWANCE)
                                .expect("allowance must be non-zero"),
                        ),
                        env::current_account_id(),
                        "request_sign".to_string(),
                    )
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(Gas::from_tgas(5))
                            .on_agent_created(vault_id, name.clone()),
                    );

                format!("agent {} creation initiated", name)
            }
            OwnerAction::RemoveAgent { vault_id, agent } => {
                let vault = self.vaults.get_mut(&vault_id).expect("vault not found");
                if vault.owner != owner {
                    env::panic_str("not owner");
                }

                vault.agents.retain(|a| a != &agent);
                self.agent_to_vault.remove(&agent);

                emit_event(Event::AgentRemoved {
                    vault_id,
                    agent: agent.to_string(),
                });

                format!("agent {} removed", agent)
            }
            OwnerAction::SetPolicy { vault_id, policy } => {
                let vault = self.vaults.get_mut(&vault_id).expect("vault not found");
                if vault.owner != owner {
                    env::panic_str("not owner");
                }
                Self::validate_policy(&policy);

                let is_stricter = Self::is_policy_stricter(&policy, &vault.policy);

                if is_stricter {
                    vault.policy = policy;
                    vault.pending_loosen = None;
                    emit_event(Event::PolicyChanged { vault_id });
                    "policy updated immediately (stricter)".to_string()
                } else {
                    let effective_ns = env::block_timestamp() + vault.policy.loosen_delay_ns.0;
                    vault.pending_loosen = Some((policy, effective_ns));
                    emit_event(Event::PolicyLoosenScheduled {
                        vault_id,
                        effective_ns,
                    });
                    format!("policy loosen scheduled for {}", effective_ns)
                }
            }
            OwnerAction::AddRecipient {
                vault_id,
                recipient,
            } => {
                let vault = self.vaults.get_mut(&vault_id).expect("vault not found");
                if vault.owner != owner {
                    env::panic_str("not owner");
                }

                let recipient_bytes = base58_decode(&recipient);
                vault.recipients.insert(recipient_bytes);

                format!("recipient {} added", recipient)
            }
            OwnerAction::RemoveRecipient {
                vault_id,
                recipient,
            } => {
                let vault = self.vaults.get_mut(&vault_id).expect("vault not found");
                if vault.owner != owner {
                    env::panic_str("not owner");
                }

                let recipient_bytes = base58_decode(&recipient);
                vault.recipients.remove(&recipient_bytes);

                format!("recipient {} removed", recipient)
            }
            OwnerAction::RegisterTokenAccount {
                vault_id,
                ata,
                mint,
                decimals,
            } => {
                let vault = self.vaults.get_mut(&vault_id).expect("vault not found");
                if vault.owner != owner {
                    env::panic_str("not owner");
                }

                let ata_bytes = base58_decode(&ata);
                let mint_bytes = base58_decode(&mint);
                vault
                    .token_accounts
                    .insert(ata_bytes, (mint_bytes, decimals));

                format!("token account {} registered", ata)
            }
            OwnerAction::Pause { vault_id } => {
                let vault = self.vaults.get_mut(&vault_id).expect("vault not found");
                if vault.owner != owner {
                    env::panic_str("not owner");
                }

                vault.paused = true;

                emit_event(Event::Paused { vault_id });

                format!("vault {} paused", vault_id)
            }
            OwnerAction::Unpause { vault_id } => {
                let vault = self.vaults.get_mut(&vault_id).expect("vault not found");
                if vault.owner != owner {
                    env::panic_str("not owner");
                }

                vault.paused = false;

                emit_event(Event::Unpaused { vault_id });

                format!("vault {} unpaused", vault_id)
            }
            OwnerAction::Release { vault_id, req_id } => {
                let vault = self.vaults.get(&vault_id).expect("vault not found");
                if vault.owner != owner {
                    env::panic_str("not owner");
                }

                let req_id_bytes = hex::decode(&req_id).expect("invalid req_id hex");
                if req_id_bytes.len() != 32 {
                    env::panic_str("invalid req_id length");
                }
                let mut req_id_arr = [0u8; 32];
                req_id_arr.copy_from_slice(&req_id_bytes);

                let request = self.requests.get(&req_id_arr).expect("request not found");
                let mut request = request.clone();

                if request.vault_id != vault_id {
                    env::panic_str("request not in vault");
                }

                // Only allow release for Failed or expired requests, not Signed ones
                match request.status {
                    Status::Failed => {
                        // on_signed already released the reservation when the request failed
                        env::panic_str("failed request already released");
                    }
                    Status::Pending => {
                        // Check if blockhash is expired (older than ~2 minutes in nanoseconds)
                        let now = env::block_timestamp();
                        let request_age_ns = now.saturating_sub(request.created_ns);
                        let two_minutes_ns = 120 * 1_000_000_000;
                        if request_age_ns < two_minutes_ns {
                            env::panic_str("request not expired yet");
                        }
                    }
                    Status::Signed => {
                        env::panic_str("cannot release signed request");
                    }
                    Status::Released => {
                        env::panic_str("request already released");
                    }
                }

                self.release_reservation(&request);
                request.status = Status::Released;
                self.requests.insert(req_id_arr, request);

                emit_event(Event::Released {
                    req_id: req_id.clone(),
                    vault_id,
                });

                format!("request {} released", req_id)
            }
        }
    }

    fn validate_policy(policy: &Policy) {
        if let Err(e) = decode_policy_programs(&policy.programs) {
            env::panic_str(e);
        }
    }

    fn is_policy_stricter(new: &Policy, old: &Policy) -> bool {
        // Allowing a program the old policy did not allow is a loosening
        if new.programs.iter().any(|p| !old.programs.contains(p)) {
            return false;
        }

        for (mint, new_limit) in &new.per_tx_limit {
            if let Some((_, old_limit)) = old.per_tx_limit.iter().find(|(m, _)| m == mint) {
                if new_limit.0 > old_limit.0 {
                    return false;
                }
            } else {
                return false;
            }
        }

        for (mint, new_cap) in &new.daily_cap {
            if let Some((_, old_cap)) = old.daily_cap.iter().find(|(m, _)| m == mint) {
                if new_cap.0 > old_cap.0 {
                    return false;
                }
            } else {
                return false;
            }
        }

        if new.max_priority_fee_lamports.0 > old.max_priority_fee_lamports.0 {
            return false;
        }

        if new.max_memo_len > old.max_memo_len {
            return false;
        }

        if new.expires_at_ns.0 > old.expires_at_ns.0 {
            return false;
        }

        true
    }
}
