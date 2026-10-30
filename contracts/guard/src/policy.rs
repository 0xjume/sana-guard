use crate::events::*;
use crate::parser::*;
use crate::types::*;
use crate::{
    base64_decode_vec, mint_to_string, reserve_spend, Guard, GAS_BUFFER, MPC_SIGN_GAS,
    ON_SIGNED_GAS,
};
use near_sdk::serde::Serialize;
use near_sdk::{env, NearToken, Promise};

impl Guard {
    pub fn process_sign_request(
        &mut self,
        vault_id: u32,
        message_b64: String,
        req_id_hex: String,
    ) -> Promise {
        if self.global_paused {
            env::panic_str("SG_E051_GLOBAL_PAUSED");
        }

        let predecessor = env::predecessor_account_id();
        let agent_vault = self
            .agent_to_vault
            .get(&predecessor)
            .copied()
            .unwrap_or_else(|| env::panic_str("SG_E052_AGENT_NOT_REGISTERED"));

        if agent_vault != vault_id {
            env::panic_str("SG_E053_VAULT_MISMATCH");
        }

        // First, do all validation with immutable access
        let vault = self
            .vaults
            .get(&vault_id)
            .unwrap_or_else(|| env::panic_str("SG_E054_VAULT_NOT_FOUND"));

        // F3a: Reject pending vaults
        if vault.state != VaultState::Active {
            env::panic_str("SG_E076_VAULT_NOT_ACTIVE");
        }

        if vault.paused {
            env::panic_str("SG_E055_VAULT_PAUSED");
        }

        if !vault.agents.contains(&predecessor) {
            env::panic_str("SG_E056_AGENT_NOT_IN_VAULT");
        }

        let now = env::block_timestamp();
        if now >= vault.policy.expires_at_ns.0 {
            env::panic_str("SG_E057_POLICY_EXPIRED");
        }

        let req_id_vec = hex::decode(&req_id_hex).expect("invalid req_id hex");
        if req_id_vec.len() != 32 {
            env::panic_str("SG_E058_INVALID_REQ_ID");
        }
        let mut req_id = [0u8; 32];
        req_id.copy_from_slice(&req_id_vec);

        if self.requests.contains_key(&req_id) {
            env::panic_str("SG_E059_DUPLICATE_REQ_ID");
        }

        let message_bytes = base64_decode_vec(&message_b64);

        let msg_hash = env::sha256(&message_bytes);
        let mut msg_hash_arr = [0u8; 32];
        msg_hash_arr.copy_from_slice(&msg_hash);

        let now_hour = now / (3600 * 1_000_000_000);
        for hour_offset in 0..24 {
            if let Some(hour) = now_hour.checked_sub(hour_offset) {
                if let Some(hashes) = vault.bucket_hashes.get(&hour) {
                    for hash in hashes.iter() {
                        if hash == &msg_hash_arr {
                            env::panic_str("SG_E060_DUPLICATE_MSG_HASH");
                        }
                    }
                }
            }
        }

        let parsed = match parse_solana_message(&message_bytes) {
            Ok(p) => p,
            Err(e) => env::panic_str(e),
        };

        if parsed.fee_payer != vault.vault_address {
            env::panic_str("SG_E061_WRONG_FEE_PAYER");
        }

        let allowed_programs = match decode_policy_programs(&vault.policy.programs) {
            Ok(p) => p,
            Err(e) => env::panic_str(e),
        };

        for ix in &parsed.instructions {
            if !allowed_programs.contains(&ix.program_id()) {
                env::panic_str("SG_E074_PROGRAM_NOT_ALLOWED");
            }
            self.check_instruction_policy(vault, ix);
        }

        let spend = match calculate_spend(&parsed.instructions, &vault.vault_address) {
            Ok(s) => s,
            Err(e) => env::panic_str(e),
        };

        for (mint, amount) in &spend {
            let limit_found = vault
                .policy
                .per_tx_limit
                .iter()
                .find(|(m, _)| m == mint)
                .map(|(_, l)| l.0);

            match limit_found {
                Some(limit) => {
                    if *amount > limit {
                        env::panic_str("SG_E062_PER_TX_LIMIT_EXCEEDED");
                    }
                }
                None => env::panic_str("SG_E063_MINT_NOT_IN_PER_TX_LIMIT"),
            }
        }

        let mut spend_24h: std::collections::HashMap<Mint, u64> = std::collections::HashMap::new();
        for hour_offset in 0..24 {
            if let Some(hour) = now_hour.checked_sub(hour_offset) {
                if let Some(entries) = vault.bucket_spend.get(&hour) {
                    for (mint, amount) in entries.iter() {
                        *spend_24h.entry(mint.clone()).or_insert(0) += amount;
                    }
                }
            }
        }

        for (mint, amount) in &spend {
            let existing = spend_24h.get(mint).copied().unwrap_or(0);
            let new_total = existing.saturating_add(*amount);

            let cap_found = vault
                .policy
                .daily_cap
                .iter()
                .find(|(m, _)| m == mint)
                .map(|(_, c)| c.0);

            match cap_found {
                Some(cap) => {
                    if new_total > cap {
                        env::panic_str("SG_E064_DAILY_CAP_EXCEEDED");
                    }
                }
                None => env::panic_str("SG_E065_MINT_NOT_IN_DAILY_CAP"),
            }
        }

        let gas_required = MPC_SIGN_GAS
            .checked_add(ON_SIGNED_GAS)
            .and_then(|g| g.checked_add(GAS_BUFFER))
            .unwrap();

        if env::prepaid_gas().saturating_sub(env::used_gas()) < gas_required {
            env::panic_str("SG_E066_INSUFFICIENT_GAS");
        }

        // Now do mutations with mutable access
        let vault = self.vaults.get_mut(&vault_id).unwrap();

        reserve_spend(vault, now_hour, &msg_hash_arr, &spend);

        // Get vault info before dropping the mutable borrow
        let vault_path = vault.path.clone();

        let request = SignRequest {
            vault_id,
            agent: predecessor.clone(),
            msg_hash: msg_hash_arr,
            spend: spend.clone(),
            hour: now_hour,
            status: Status::Pending,
            signature: None,
            created_ns: now,
        };

        self.requests.insert(req_id, request);

        emit_event(Event::SignRequested {
            req_id: hex::encode(req_id),
            vault_id,
            agent: predecessor.to_string(),
            spend: spend.iter().map(|(m, a)| (mint_to_string(m), *a)).collect(),
            msg_hash: hex::encode(msg_hash_arr),
        });

        #[derive(Serialize)]
        #[serde(crate = "near_sdk::serde")]
        struct SignArgs {
            request: MpcSignRequest,
        }

        #[derive(Serialize)]
        #[serde(crate = "near_sdk::serde")]
        struct MpcSignRequest {
            path: String,
            payload_v2: PayloadV2,
            domain_id: u32,
        }

        #[derive(Serialize)]
        #[serde(crate = "near_sdk::serde")]
        enum PayloadV2 {
            Eddsa(String),
        }

        let args = SignArgs {
            request: MpcSignRequest {
                path: vault_path,
                payload_v2: PayloadV2::Eddsa(hex::encode(&message_bytes)),
                domain_id: self.mpc_domain_id,
            },
        };

        let args_json = serde_json::to_vec(&args).expect("serialization failed");

        Promise::new(self.mpc_contract.clone())
            .function_call(
                "sign".to_string(),
                args_json,
                NearToken::from_yoctonear(1),
                MPC_SIGN_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_SIGNED_GAS)
                    .on_signed(req_id),
            )
    }

    fn check_instruction_policy(&self, vault: &Vault, ix: &ParsedInstruction) {
        match ix {
            ParsedInstruction::SystemTransfer { to, .. } => {
                if !vault.recipients.contains(to) {
                    env::panic_str("SG_E067_RECIPIENT_NOT_ALLOWED");
                }
            }
            ParsedInstruction::TokenTransfer { dest, mint, .. } => {
                if !vault.recipients.contains(dest) {
                    env::panic_str("SG_E068_RECIPIENT_NOT_ALLOWED");
                }

                if mint != &[0u8; 32] {
                    let found = vault
                        .policy
                        .per_tx_limit
                        .iter()
                        .any(|(m, _)| m == &Mint::Spl(*mint));
                    if !found {
                        env::panic_str("SG_E069_MINT_NOT_IN_POLICY");
                    }
                }
            }
            ParsedInstruction::AtaCreate { ata, mint, .. } => {
                if !vault.recipients.contains(ata) {
                    env::panic_str("SG_E070_ATA_NOT_ALLOWED");
                }

                let found = vault
                    .policy
                    .per_tx_limit
                    .iter()
                    .any(|(m, _)| m == &Mint::Spl(*mint));
                if !found {
                    env::panic_str("SG_E071_MINT_NOT_IN_POLICY");
                }
            }
            ParsedInstruction::ComputeBudgetSetLimit { limit } => {
                if let Some(_price_ix) = vault.policy.programs.iter().find(|_| *limit > 0) {
                    // This will be fully validated in calculate_spend
                }
            }
            ParsedInstruction::ComputeBudgetSetPrice { micro_lamports } => {
                // Will be validated with limit in calculate_spend
                // For now just check that price is not absurdly high
                let max_fee = vault.policy.max_priority_fee_lamports.0;
                if *micro_lamports > max_fee * 1_000_000 {
                    env::panic_str("SG_E072_PRIORITY_FEE_TOO_HIGH");
                }
            }
            ParsedInstruction::Memo { text } => {
                if text.len() > vault.policy.max_memo_len as usize {
                    env::panic_str("SG_E073_MEMO_TOO_LONG");
                }
            }
        }
    }

    pub fn handle_signed_callback(
        &mut self,
        req_id: [u8; 32],
        result: Result<MpcSignature, near_sdk::PromiseError>,
    ) -> Option<Vec<u8>> {
        let mut request = self.requests.get(&req_id)?.clone();

        let signature = match result {
            Ok(MpcSignature::Ed25519 { signature }) if signature.len() == 64 => Some(signature),
            _ => None,
        };

        match (&request.status, signature) {
            (Status::Pending, Some(signature)) => {
                request.status = Status::Signed;
                request.signature = Some(signature.clone());
                self.requests.insert(req_id, request.clone());

                emit_event(Event::Signed {
                    req_id: hex::encode(req_id),
                    vault_id: request.vault_id,
                });

                Some(signature)
            }
            (Status::Pending, None) => {
                // Every Failed request has had its reservation released exactly once, here.
                self.release_reservation(&request);
                request.status = Status::Failed;
                self.requests.insert(req_id, request.clone());

                emit_event(Event::SignFailed {
                    req_id: hex::encode(req_id),
                    vault_id: request.vault_id,
                });

                None
            }
            (Status::Released, Some(signature)) => {
                // The owner released this request while MPC was still working, but a valid
                // signature is money out, so put the spend back on the books.
                if let Some(vault) = self.vaults.get_mut(&request.vault_id) {
                    reserve_spend(vault, request.hour, &request.msg_hash, &request.spend);
                }
                request.status = Status::Signed;
                request.signature = Some(signature.clone());
                self.requests.insert(req_id, request.clone());

                emit_event(Event::Signed {
                    req_id: hex::encode(req_id),
                    vault_id: request.vault_id,
                });

                Some(signature)
            }
            // Released + no signature: the reservation is already gone, nothing to undo.
            // Signed/Failed: the callback already ran for this request.
            _ => None,
        }
    }
}
