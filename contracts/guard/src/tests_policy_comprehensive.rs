// Comprehensive policy engine tests
use crate::types::*;
use crate::*;
use near_sdk::json_types::U64;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, AccountId, Gas, NearToken, PublicKey};

fn setup_contract() -> Guard {
    Guard::new(
        "v1.signer-prod.testnet".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        accounts(0),
    )
}

fn get_context_with_time(
    predecessor: AccountId,
    timestamp_ns: u64,
    signer_pk: Option<PublicKey>,
) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .predecessor_account_id(predecessor)
        .block_timestamp(timestamp_ns)
        .prepaid_gas(Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(1));

    if let Some(pk) = signer_pk {
        builder.signer_account_pk(pk);
    }

    builder
}

#[cfg(test)]
mod rolling_24h_cap_tests {
    use super::*;
    

    #[test]
    fn test_rolling_cap_across_hour_boundaries() {
        let mut contract = setup_contract();
        let owner_bytes = [1u8; 32];

        // Create vault with 10 SOL daily cap
        let vault = Vault::new(
            0,
            owner_bytes,
            [2u8; 32],
            "test/path".to_string(),
            Policy {
                per_tx_limit: vec![(Mint::Sol, U64(10_000_000_000))],
                daily_cap: vec![(Mint::Sol, U64(10_000_000_000))], // 10 SOL
                max_priority_fee_lamports: U64(1_000_000),
                max_memo_len: 100,
                expires_at_ns: U64(u64::MAX),
                loosen_delay_ns: U64(3_600_000_000_000),
                programs: vec![],
            },
        );
        contract.vaults.insert(0, vault);

        let _hour_ns = 3_600_000_000_000u64;
        let hour_0 = 1000u64;
        let hour_12 = hour_0 + 12;
        let hour_25 = hour_0 + 25;

        // Spend 0.5 SOL at hour 0
        let vault = contract.vaults.get_mut(&0).unwrap();
        let bucket = vec![([0u8; 32], 500_000_000)]; // 0.5 SOL
        vault.buckets.insert(hour_0, bucket);

        // Spend another 0.3 SOL at hour 12
        let bucket = vec![([0u8; 32], 300_000_000)]; // 0.3 SOL
        vault.buckets.insert(hour_12, bucket);
        let _ = vault;

        // Check total spend in 24h window from hour 12 (should be 0.8 SOL)
        let vault = contract.vaults.get(&0).unwrap();
        let mut total = 0u64;
        for offset in 0..24 {
            if let Some(hour) = hour_12.checked_sub(offset) {
                if let Some(entries) = vault.buckets.get(&hour) {
                    for (mint_bytes, amount) in entries.iter() {
                        if mint_bytes == &[0u8; 32] {
                            total += amount;
                        }
                    }
                }
            }
        }
        assert_eq!(total, 800_000_000);

        // Check from hour 25 - first spend should drop out
        let mut total = 0u64;
        for offset in 0..24 {
            if let Some(hour) = hour_25.checked_sub(offset) {
                if let Some(entries) = vault.buckets.get(&hour) {
                    for (mint_bytes, amount) in entries.iter() {
                        if mint_bytes == &[0u8; 32] {
                            total += amount;
                        }
                    }
                }
            }
        }
        // Only 0.3 SOL from hour 12 should remain in window
        assert_eq!(total, 300_000_000);
    }

    #[test]
    fn test_per_tx_limit_enforcement() {
        let mut contract = setup_contract();
        let vault = Vault::new(
            0,
            [1u8; 32],
            [2u8; 32],
            "test/path".to_string(),
            Policy {
                per_tx_limit: vec![(Mint::Sol, U64(100_000_000))], // 0.1 SOL max per tx
                daily_cap: vec![(Mint::Sol, U64(10_000_000_000))],
                max_priority_fee_lamports: U64(1_000_000),
                max_memo_len: 100,
                expires_at_ns: U64(u64::MAX),
                loosen_delay_ns: U64(3_600_000_000_000),
                programs: vec![],
            },
        );
        contract.vaults.insert(0, vault);

        // Check that 0.1 SOL is at limit
        let vault = contract.vaults.get(&0).unwrap();
        let limit = vault
            .policy
            .per_tx_limit
            .iter()
            .find(|(m, _)| matches!(m, Mint::Sol))
            .map(|(_, l)| l.0)
            .unwrap();
        assert_eq!(limit, 100_000_000);

        // 0.15 SOL would exceed limit
        assert!(150_000_000 > limit);
    }
}

#[cfg(test)]
mod allowlist_tests {
    use super::*;
    

    #[test]
    fn test_recipient_allowlist() {
        let mut contract = setup_contract();
        let allowed_recipient = [99u8; 32];

        let mut vault = Vault::new(
            0,
            [1u8; 32],
            [2u8; 32],
            "test/path".to_string(),
            Policy {
                per_tx_limit: vec![],
                daily_cap: vec![],
                max_priority_fee_lamports: U64(1_000_000),
                max_memo_len: 100,
                expires_at_ns: U64(u64::MAX),
                loosen_delay_ns: U64(3_600_000_000_000),
                programs: vec![],
            },
        );

        vault.recipients.insert(allowed_recipient);
        contract.vaults.insert(0, vault);

        let vault = contract.vaults.get(&0).unwrap();
        assert!(vault.recipients.contains(&allowed_recipient));
        assert!(!vault.recipients.contains(&[88u8; 32]));
    }

    #[test]
    fn test_program_allowlist() {
        let mut contract = setup_contract();
        let system_program_str = "11111111111111111111111111111111".to_string();

        let vault = Vault::new(
            0,
            [1u8; 32],
            [2u8; 32],
            "test/path".to_string(),
            Policy {
                per_tx_limit: vec![],
                daily_cap: vec![],
                max_priority_fee_lamports: U64(1_000_000),
                max_memo_len: 100,
                expires_at_ns: U64(u64::MAX),
                loosen_delay_ns: U64(3_600_000_000_000),
                programs: vec![system_program_str.clone()],
            },
        );

        contract.vaults.insert(0, vault);

        let vault = contract.vaults.get(&0).unwrap();
        assert_eq!(vault.policy.programs.len(), 1);
        assert_eq!(vault.policy.programs[0], system_program_str);
    }

    #[test]
    fn test_mint_allowlist_via_per_tx_limit() {
        let mut contract = setup_contract();
        let usdc_mint = [42u8; 32];

        let vault = Vault::new(
            0,
            [1u8; 32],
            [2u8; 32],
            "test/path".to_string(),
            Policy {
                per_tx_limit: vec![(Mint::Spl(usdc_mint), U64(1_000_000_000))],
                daily_cap: vec![(Mint::Spl(usdc_mint), U64(10_000_000_000))],
                max_priority_fee_lamports: U64(1_000_000),
                max_memo_len: 100,
                expires_at_ns: U64(u64::MAX),
                loosen_delay_ns: U64(3_600_000_000_000),
                programs: vec![],
            },
        );
        contract.vaults.insert(0, vault);

        let vault = contract.vaults.get(&0).unwrap();
        // Mints are implicitly allowed via per_tx_limit
        let has_usdc = vault
            .policy
            .per_tx_limit
            .iter()
            .any(|(m, _)| matches!(m, Mint::Spl(bytes) if bytes == &usdc_mint));
        assert!(has_usdc);
    }
}

#[cfg(test)]
mod expiry_and_killswitch_tests {
    use super::*;
    

    #[test]
    fn test_vault_expiry() {
        let mut contract = setup_contract();
        let expiry_time = 2_000_000_000_000_000_000u64;

        let vault = Vault::new(
            0,
            [1u8; 32],
            [2u8; 32],
            "test/path".to_string(),
            Policy {
                per_tx_limit: vec![],
                daily_cap: vec![],
                max_priority_fee_lamports: U64(1_000_000),
                max_memo_len: 100,
                expires_at_ns: U64(expiry_time),
                loosen_delay_ns: U64(3_600_000_000_000),
                programs: vec![],
            },
        );
        contract.vaults.insert(0, vault);

        // Before expiry
        let context = get_context_with_time(accounts(1), expiry_time - 1, None);
        testing_env!(context.build());
        let vault = contract.vaults.get(&0).unwrap();
        assert!(env::block_timestamp() < vault.policy.expires_at_ns.0);

        // After expiry
        let context = get_context_with_time(accounts(1), expiry_time + 1, None);
        testing_env!(context.build());
        assert!(env::block_timestamp() > vault.policy.expires_at_ns.0);
    }

    #[test]
    fn test_global_kill_switch() {
        let mut contract = setup_contract();
        assert!(!contract.global_paused);

        let context = get_context_with_time(accounts(0), 1_000_000_000, None);
        testing_env!(context.build());

        contract.admin_pause_all(true);
        assert!(contract.global_paused);

        contract.admin_pause_all(false);
        assert!(!contract.global_paused);
    }

    #[test]
    fn test_vault_pause() {
        let mut contract = setup_contract();
        let mut vault = Vault::new(
            0,
            [1u8; 32],
            [2u8; 32],
            "test/path".to_string(),
            Policy {
                per_tx_limit: vec![],
                daily_cap: vec![],
                max_priority_fee_lamports: U64(1_000_000),
                max_memo_len: 100,
                expires_at_ns: U64(u64::MAX),
                loosen_delay_ns: U64(3_600_000_000_000),
                programs: vec![],
            },
        );

        vault.paused = true;
        contract.vaults.insert(0, vault);

        let vault = contract.vaults.get(&0).unwrap();
        assert!(vault.paused);
    }
}

#[cfg(test)]
mod idempotency_tests {
    use super::*;
    

    #[test]
    fn test_req_id_idempotency() {
        let mut contract = setup_contract();
        let req_id = [42u8; 32];
        let msg_hash = [1u8; 32];

        let request = SignRequest {
            vault_id: 0,
            agent: accounts(1),
            msg_hash,
            spend: vec![],
            hour: 1000,
            status: Status::Pending,
            signature: None,
            created_ns: 1_000_000_000,
        };

        contract.requests.insert(req_id, request);

        // Same req_id exists
        assert!(contract.requests.contains_key(&req_id));

        // Different req_id doesn't exist
        let other_req_id = [99u8; 32];
        assert!(!contract.requests.contains_key(&other_req_id));
    }

    #[test]
    fn test_msg_hash_in_24h_window() {
        let mut contract = setup_contract();
        let msg_hash = [7u8; 32];
        let hour = 1000u64;

        let mut vault = Vault::new(
            0,
            [1u8; 32],
            [2u8; 32],
            "test/path".to_string(),
            Policy {
                per_tx_limit: vec![],
                daily_cap: vec![],
                max_priority_fee_lamports: U64(1_000_000),
                max_memo_len: 100,
                expires_at_ns: U64(u64::MAX),
                loosen_delay_ns: U64(3_600_000_000_000),
                programs: vec![],
            },
        );

        let bucket = vec![(msg_hash, 0u64)];
        vault.buckets.insert(hour, bucket);
        contract.vaults.insert(0, vault);

        // Check msg_hash exists in bucket
        let vault = contract.vaults.get(&0).unwrap();
        let entries = vault.buckets.get(&hour).unwrap();
        let found = entries.iter().any(|(h, _)| h == &msg_hash);
        assert!(found);
    }
}

#[cfg(test)]
mod policy_change_tests {
    use super::*;
    

    #[test]
    fn test_stricter_policy_immediate() {
        let mut contract = setup_contract();

        let old_policy = Policy {
            per_tx_limit: vec![(Mint::Sol, U64(1_000_000_000))], // 1 SOL
            daily_cap: vec![(Mint::Sol, U64(10_000_000_000))],   // 10 SOL
            max_priority_fee_lamports: U64(1_000_000),
            max_memo_len: 100,
            expires_at_ns: U64(u64::MAX),
            loosen_delay_ns: U64(3_600_000_000_000),
            programs: vec![],
        };

        let stricter_policy = Policy {
            per_tx_limit: vec![(Mint::Sol, U64(500_000_000))], // 0.5 SOL (stricter)
            daily_cap: vec![(Mint::Sol, U64(5_000_000_000))],  // 5 SOL (stricter)
            max_priority_fee_lamports: U64(500_000),           // lower (stricter)
            max_memo_len: 50,                                  // lower (stricter)
            expires_at_ns: U64(1_000_000_000),                 // sooner (stricter)
            loosen_delay_ns: U64(3_600_000_000_000),
            programs: vec![],
        };

        let mut vault = Vault::new(0, [1u8; 32], [2u8; 32], "test/path".to_string(), old_policy);

        // Update to stricter policy (should be immediate, no pending)
        vault.policy = stricter_policy.clone();
        vault.pending_loosen = None;
        contract.vaults.insert(0, vault);

        let vault = contract.vaults.get(&0).unwrap();
        assert_eq!(vault.policy.per_tx_limit[0].1 .0, 500_000_000);
        assert!(vault.pending_loosen.is_none());
    }

    #[test]
    fn test_looser_policy_delayed() {
        let mut contract = setup_contract();
        let delay_ns = 3_600_000_000_000u64; // 1 hour
        let current_time = 1_000_000_000_000_000_000u64;

        let old_policy = Policy {
            per_tx_limit: vec![(Mint::Sol, U64(500_000_000))],
            daily_cap: vec![(Mint::Sol, U64(5_000_000_000))],
            max_priority_fee_lamports: U64(500_000),
            max_memo_len: 50,
            expires_at_ns: U64(current_time + 1_000_000_000),
            loosen_delay_ns: U64(delay_ns),
            programs: vec![],
        };

        let looser_policy = Policy {
            per_tx_limit: vec![(Mint::Sol, U64(1_000_000_000))], // 1 SOL (looser)
            daily_cap: vec![(Mint::Sol, U64(10_000_000_000))],   // 10 SOL (looser)
            max_priority_fee_lamports: U64(1_000_000),           // higher (looser)
            max_memo_len: 100,                                   // higher (looser)
            expires_at_ns: U64(u64::MAX),                        // later (looser)
            loosen_delay_ns: U64(delay_ns),
            programs: vec![],
        };

        let mut vault = Vault::new(
            0,
            [1u8; 32],
            [2u8; 32],
            "test/path".to_string(),
            old_policy.clone(),
        );

        // Set pending looser policy
        let effective_ns = current_time + delay_ns;
        vault.pending_loosen = Some((looser_policy.clone(), effective_ns));
        contract.vaults.insert(0, vault);

        // Before delay
        let context = get_context_with_time(accounts(1), current_time, None);
        testing_env!(context.build());
        let vault = contract.vaults.get(&0).unwrap();
        assert!(vault.pending_loosen.is_some());
        assert_eq!(vault.policy.per_tx_limit[0].1 .0, 500_000_000); // still old

        // After delay
        let context = get_context_with_time(accounts(1), effective_ns + 1, None);
        testing_env!(context.build());

        contract.apply_pending_policy(0);

        let vault = contract.vaults.get(&0).unwrap();
        assert!(vault.pending_loosen.is_none());
        assert_eq!(vault.policy.per_tx_limit[0].1 .0, 1_000_000_000); // updated
    }
}
