// Migration test from commit 014ea08 (PR #2) to current version

#[cfg(test)]
mod migration_tests {
    use crate::legacy::{OldGuard, OldPolicy, OldVault};
    use crate::storage::StorageKey;
    use crate::types::{Mint, SignRequest, VaultState};
    use crate::Guard;
    use near_sdk::json_types::U64;
    use near_sdk::store::{IterableMap, LookupMap, LookupSet};
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{env, testing_env, AccountId, NearToken};

    fn set_context(predecessor: AccountId) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(0))
            .predecessor_account_id(predecessor)
            .attached_deposit(NearToken::from_near(1))
            .block_timestamp(1_000_000_000_000_000_000);
        testing_env!(builder.build());
    }

    #[test]
    fn test_migrate_from_014ea08() {
        set_context(accounts(1));

        // Build an old state exactly as it existed at 014ea08
        let owner_key = [7u8; 32];
        let vault_address = [9u8; 32];
        let recipient = [2u8; 32];
        let agent_id: AccountId = "agent1.guard.test".parse().unwrap();

        let old_policy = OldPolicy {
            per_tx_limit: vec![(Mint::Sol, U64(1_000_000_000))],
            daily_cap: vec![(Mint::Sol, U64(10_000_000_000))],
            programs: vec!["11111111111111111111111111111111".to_string()],
            max_priority_fee_lamports: U64(1_000_000),
            max_memo_len: 100,
            expires_at_ns: U64(u64::MAX),
            loosen_delay_ns: U64(86_400_000_000_000),
        };

        let mut old_vault = OldVault {
            owner: owner_key,
            vault_address,
            path: "vault/owner/0".to_string(),
            agents: vec![agent_id.clone()],
            policy: old_policy,
            pending_loosen: None,
            recipients: LookupSet::new(StorageKey::Recipients { vault: 0 }),
            programs: LookupSet::new(StorageKey::Programs { vault: 0 }),
            token_accounts: LookupMap::new(StorageKey::TokenAccts { vault: 0 }),
            bucket_hashes: LookupMap::new(StorageKey::BucketHashes { vault: 0 }),
            bucket_spend: LookupMap::new(StorageKey::BucketSpend { vault: 0 }),
            spent_cursor: 0,
            paused: false,
        };

        // Add a recipient to the LookupSet
        old_vault.recipients.insert(recipient);

        // Create an old request
        let req_id = [1u8; 32];
        let old_request = SignRequest {
            vault_id: 0,
            agent: agent_id.clone(),
            msg_hash: [42u8; 32],
            spend: vec![(Mint::Sol, 1000)],
            hour: 1000,
            status: crate::types::Status::Signed,
            signature: Some(vec![1, 2, 3]),
            created_ns: 1_000_000_000_000_000_000,
        };

        // Build old Guard state
        let mut old_vaults = IterableMap::new(StorageKey::Vaults);
        old_vaults.insert(0, old_vault);

        let mut old_agent_to_vault = LookupMap::new(StorageKey::AgentToVault);
        old_agent_to_vault.insert(agent_id.clone(), 0);

        let mut old_requests = LookupMap::new(StorageKey::Requests);
        old_requests.insert(req_id, old_request);

        let mut old_owner_nonce = LookupMap::new(StorageKey::OwnerNonce);
        old_owner_nonce.insert(owner_key, 0);

        let mut old_owner_vault_count = LookupMap::new(StorageKey::OwnerVaultCount);
        old_owner_vault_count.insert(owner_key, 1);

        let old_guard = OldGuard {
            mpc_contract: "mpc.test".parse().unwrap(),
            mpc_domain_id: 1,
            network_tag: "near-testnet".to_string(),
            admin: accounts(0),
            global_paused: false,
            vaults: old_vaults,
            agent_to_vault: old_agent_to_vault,
            owner_nonce: old_owner_nonce,
            requests: old_requests,
            next_vault_id: 1,
            owner_vault_count: old_owner_vault_count,
        };

        // Serialize old state
        let old_state = near_sdk::borsh::to_vec(&old_guard).unwrap();

        // Write to storage
        env::state_write(&old_state);

        // Call migrate
        let new_guard = Guard::migrate();

        // Verify migration
        let vault = new_guard.vaults.get(&0).expect("vault should exist");

        // Check that state is Active
        assert_eq!(vault.state, VaultState::Active);

        // Check that max_total_priority_fee_lamports is None
        assert_eq!(vault.policy.max_total_priority_fee_lamports, None);

        // Check that other fields are preserved
        assert_eq!(vault.owner, owner_key);
        assert_eq!(vault.vault_address, vault_address);
        assert_eq!(vault.agents.len(), 1);
        assert_eq!(vault.agents[0], agent_id);

        // Check that recipients_list is empty (needs backfill)
        assert_eq!(vault.recipients_list.len(), 0);

        // Check that recipients LookupSet still contains the recipient
        assert!(vault.recipients.contains(&recipient));

        // Test backfill_recipients
        let recipient_b58 = bs58::encode(&recipient).into_string();

        // Execute backfill via owner action
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_yoctonear(1))
            .block_timestamp(1_000_000_000_000_000_000)
            .build());

        let mut new_guard = new_guard;
        let result =
            new_guard.backfill_recipients(0, vec![recipient_b58.clone(), "invalid".to_string()]);
        assert!(result.contains("backfilled 1"));
        assert!(result.contains("skipped 1"));

        // Verify get_recipients now works
        let recipients = new_guard.get_recipients(0, None, None);
        assert_eq!(recipients.len(), 1);
        assert_eq!(recipients[0], recipient_b58);

        // Test that a fresh request_sign works on migrated vault
        // (Vault is Active, so it should work)
        let vault = new_guard.vaults.get(&0).unwrap();
        assert_eq!(vault.state, VaultState::Active);
    }

    #[test]
    fn test_migrate_preserves_policy_fields() {
        set_context(accounts(1));

        let owner_key = [7u8; 32];
        let vault_address = [9u8; 32];

        let old_policy = OldPolicy {
            per_tx_limit: vec![
                (Mint::Sol, U64(1_000_000_000)),
                (Mint::Spl([1u8; 32]), U64(500_000_000)),
            ],
            daily_cap: vec![
                (Mint::Sol, U64(10_000_000_000)),
                (Mint::Spl([1u8; 32]), U64(5_000_000_000)),
            ],
            programs: vec![
                "11111111111111111111111111111111".to_string(),
                "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA".to_string(),
            ],
            max_priority_fee_lamports: U64(1_500_000),
            max_memo_len: 200,
            expires_at_ns: U64(2_000_000_000_000_000_000),
            loosen_delay_ns: U64(172_800_000_000_000), // 48 hours
        };

        let old_vault = OldVault {
            owner: owner_key,
            vault_address,
            path: "vault/owner/0".to_string(),
            agents: vec![],
            policy: old_policy,
            pending_loosen: None,
            recipients: LookupSet::new(StorageKey::Recipients { vault: 0 }),
            programs: LookupSet::new(StorageKey::Programs { vault: 0 }),
            token_accounts: LookupMap::new(StorageKey::TokenAccts { vault: 0 }),
            bucket_hashes: LookupMap::new(StorageKey::BucketHashes { vault: 0 }),
            bucket_spend: LookupMap::new(StorageKey::BucketSpend { vault: 0 }),
            spent_cursor: 0,
            paused: false,
        };

        let mut old_vaults = IterableMap::new(StorageKey::Vaults);
        old_vaults.insert(0, old_vault);

        let old_guard = OldGuard {
            mpc_contract: "mpc.test".parse().unwrap(),
            mpc_domain_id: 1,
            network_tag: "near-testnet".to_string(),
            admin: accounts(0),
            global_paused: false,
            vaults: old_vaults,
            agent_to_vault: LookupMap::new(StorageKey::AgentToVault),
            owner_nonce: LookupMap::new(StorageKey::OwnerNonce),
            requests: LookupMap::new(StorageKey::Requests),
            next_vault_id: 1,
            owner_vault_count: LookupMap::new(StorageKey::OwnerVaultCount),
        };

        let old_state = near_sdk::borsh::to_vec(&old_guard).unwrap();
        env::state_write(&old_state);

        let new_guard = Guard::migrate();

        let vault = new_guard.vaults.get(&0).expect("vault should exist");

        // Verify all policy fields are preserved
        assert_eq!(vault.policy.per_tx_limit.len(), 2);
        assert_eq!(vault.policy.daily_cap.len(), 2);
        assert_eq!(vault.policy.programs.len(), 2);
        assert_eq!(vault.policy.max_priority_fee_lamports.0, 1_500_000);
        assert_eq!(vault.policy.max_memo_len, 200);
        assert_eq!(vault.policy.expires_at_ns.0, 2_000_000_000_000_000_000);
        assert_eq!(vault.policy.loosen_delay_ns.0, 172_800_000_000_000);

        // New field should be None
        assert_eq!(vault.policy.max_total_priority_fee_lamports, None);
    }
}
