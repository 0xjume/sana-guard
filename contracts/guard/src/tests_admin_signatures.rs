// Admin signature verification tests with real ed25519-dalek keys
use crate::types::*;
use crate::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::U64;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{env, testing_env, Gas, NearToken, PublicKey};

fn deterministic_signing_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn second_key() -> SigningKey {
    SigningKey::from_bytes(&[42u8; 32])
}

fn build_admin_message(
    network: &str,
    contract: &str,
    vault: Option<u32>,
    nonce: u64,
    expires: u64,
    action_json: &str,
) -> String {
    let vault_str = vault.map_or("null".to_string(), |v| v.to_string());
    format!(
        "SANA-GUARD-ADMIN-v1\nnetwork: {}\ncontract: {}\nvault: {}\nnonce: {}\nexpires: {}\naction: {}",
        network,
        contract,
        vault_str,
        nonce,
        expires,
        action_json
    )
}

fn sign_message(key: &SigningKey, message: &str) -> Vec<u8> {
    let signature = key.sign(message.as_bytes());
    signature.to_bytes().to_vec()
}

fn make_public_key(key_bytes: [u8; 32]) -> PublicKey {
    let pk_str = format!("ed25519:{}", bs58::encode(&key_bytes).into_string());
    pk_str.parse().unwrap()
}

#[cfg(test)]
mod admin_signature_tests {
    use super::*;

    #[test]
    fn test_valid_create_vault() {
        let mut contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            accounts(0),
        );

        let signing_key = deterministic_signing_key();
        let verifying_key = signing_key.verifying_key();
        let owner_pk = verifying_key.to_bytes();
        let owner_address = bs58::encode(&owner_pk).into_string();

        let action_json = format!(
            r#"{{"type":"CreateVault","owner":"{}","vault_address":"{}","policy":{{"per_tx_limit":[],"daily_cap":[],"programs":[],"max_priority_fee_lamports":"1000000","max_memo_len":100,"expires_at_ns":"999999999999999999","loosen_delay_ns":"3600000000000"}}}}"#,
            owner_address, owner_address
        );

        let message = build_admin_message(
            "near-testnet",
            env::current_account_id().as_ref(),
            None,
            1,
            env::block_timestamp() + 300_000_000_000, // 5 min from now
            &action_json,
        );

        let signature = sign_message(&signing_key, &message);

        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .signer_account_pk(make_public_key(owner_pk))
            .attached_deposit(NearToken::from_near(1))
            .prepaid_gas(Gas::from_tgas(300))
            .build();
        testing_env!(context);

        let result = contract.owner_action(message, signature);
        assert!(result.contains("vault 0 created"));
        assert_eq!(contract.next_vault_id, 1);
    }

    #[test]
    #[should_panic(expected = "invalid signature")]
    fn test_wrong_signing_key() {
        let mut contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            accounts(0),
        );

        let correct_key = deterministic_signing_key();
        let wrong_key = second_key();
        let correct_verifying = correct_key.verifying_key();
        let owner_pk = correct_verifying.to_bytes();
        let owner_address = bs58::encode(&owner_pk).into_string();

        let action_json = format!(
            r#"{{"type":"CreateVault","owner":"{}","vault_address":"{}","policy":{{"per_tx_limit":[],"daily_cap":[],"programs":[],"max_priority_fee_lamports":"1000000","max_memo_len":100,"expires_at_ns":"999999999999999999","loosen_delay_ns":"3600000000000"}}}}"#,
            owner_address, owner_address
        );

        let message = build_admin_message(
            "near-testnet",
            env::current_account_id().as_ref(),
            None,
            1,
            env::block_timestamp() + 300_000_000_000,
            &action_json,
        );

        // Sign with wrong key
        let signature = sign_message(&wrong_key, &message);

        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .signer_account_pk(make_public_key(owner_pk))
            .attached_deposit(NearToken::from_near(1))
            .prepaid_gas(Gas::from_tgas(300))
            .build();
        testing_env!(context);

        contract.owner_action(message, signature);
    }

    #[test]
    #[should_panic(expected = "wrong network")]
    fn test_tampered_network() {
        let mut contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            accounts(0),
        );

        let signing_key = deterministic_signing_key();
        let verifying_key = signing_key.verifying_key();
        let owner_pk = verifying_key.to_bytes();
        let owner_address = bs58::encode(&owner_pk).into_string();

        let action_json = format!(
            r#"{{"type":"CreateVault","owner":"{}","vault_address":"{}","policy":{{"per_tx_limit":[],"daily_cap":[],"programs":[],"max_priority_fee_lamports":"1000000","max_memo_len":100,"expires_at_ns":"999999999999999999","loosen_delay_ns":"3600000000000"}}}}"#,
            owner_address, owner_address
        );

        let message = build_admin_message(
            "near-testnet",
            env::current_account_id().as_ref(),
            None,
            1,
            env::block_timestamp() + 300_000_000_000,
            &action_json,
        );

        let signature = sign_message(&signing_key, &message);

        // Tamper with network after signing
        let tampered = message.replace("near-testnet", "near-mainnet");

        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .signer_account_pk(make_public_key(owner_pk))
            .attached_deposit(NearToken::from_near(1))
            .prepaid_gas(Gas::from_tgas(300))
            .build();
        testing_env!(context);

        contract.owner_action(tampered, signature);
    }

    #[test]
    #[should_panic(expected = "invalid signature")]
    fn test_tampered_action() {
        let mut contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            accounts(0),
        );

        let signing_key = deterministic_signing_key();
        let verifying_key = signing_key.verifying_key();
        let owner_pk = verifying_key.to_bytes();
        let owner_address = bs58::encode(&owner_pk).into_string();

        let action_json = format!(
            r#"{{"type":"CreateVault","owner":"{}","vault_address":"{}","policy":{{"per_tx_limit":[],"daily_cap":[],"programs":[],"max_priority_fee_lamports":"1000000","max_memo_len":100,"expires_at_ns":"999999999999999999","loosen_delay_ns":"3600000000000"}}}}"#,
            owner_address, owner_address
        );

        let message = build_admin_message(
            "near-testnet",
            env::current_account_id().as_ref(),
            None,
            1,
            env::block_timestamp() + 300_000_000_000,
            &action_json,
        );

        let signature = sign_message(&signing_key, &message);

        // Tamper action max_memo_len
        let tampered = message.replace("100", "200");

        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .signer_account_pk(make_public_key(owner_pk))
            .attached_deposit(NearToken::from_near(1))
            .prepaid_gas(Gas::from_tgas(300))
            .build();
        testing_env!(context);

        contract.owner_action(tampered, signature);
    }

    #[test]
    #[should_panic(expected = "message expired")]
    fn test_expired_message() {
        let mut contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            accounts(0),
        );

        let signing_key = deterministic_signing_key();
        let verifying_key = signing_key.verifying_key();
        let owner_pk = verifying_key.to_bytes();
        let owner_address = bs58::encode(&owner_pk).into_string();

        let action_json = format!(
            r#"{{"type":"CreateVault","owner":"{}","vault_address":"{}","policy":{{"per_tx_limit":[],"daily_cap":[],"programs":[],"max_priority_fee_lamports":"1000000","max_memo_len":100,"expires_at_ns":"999999999999999999","loosen_delay_ns":"3600000000000"}}}}"#,
            owner_address, owner_address
        );

        let now = 1_000_000_000_000; // 1 second in nanoseconds
        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .signer_account_pk(make_public_key(owner_pk))
            .attached_deposit(NearToken::from_near(1))
            .prepaid_gas(Gas::from_tgas(300))
            .block_timestamp(now)
            .build();
        testing_env!(context);

        // Expired 1 nanosecond ago
        let message = build_admin_message(
            "near-testnet",
            env::current_account_id().as_ref(),
            None,
            1,
            now - 1,
            &action_json,
        );

        let signature = sign_message(&signing_key, &message);

        contract.owner_action(message, signature);
    }

    #[test]
    #[should_panic(expected = "nonce too old")]
    fn test_nonce_replay() {
        let mut contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            accounts(0),
        );

        let signing_key = deterministic_signing_key();
        let verifying_key = signing_key.verifying_key();
        let owner_pk = verifying_key.to_bytes();
        let owner_address = bs58::encode(&owner_pk).into_string();

        // First use nonce 1
        contract.owner_nonce.insert(owner_pk, 1);

        let action_json = format!(
            r#"{{"type":"CreateVault","owner":"{}","vault_address":"{}","policy":{{"per_tx_limit":[],"daily_cap":[],"programs":[],"max_priority_fee_lamports":"1000000","max_memo_len":100,"expires_at_ns":"999999999999999999","loosen_delay_ns":"3600000000000"}}}}"#,
            owner_address, owner_address
        );

        // Try to replay nonce 1
        let message = build_admin_message(
            "near-testnet",
            env::current_account_id().as_ref(),
            None,
            1, // same nonce
            env::block_timestamp() + 300_000_000_000,
            &action_json,
        );

        let signature = sign_message(&signing_key, &message);

        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .signer_account_pk(make_public_key(owner_pk))
            .attached_deposit(NearToken::from_near(1))
            .prepaid_gas(Gas::from_tgas(300))
            .build();
        testing_env!(context);

        contract.owner_action(message, signature);
    }

    #[test]
    #[should_panic(expected = "nonce too old")]
    fn test_lower_nonce() {
        let mut contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            accounts(0),
        );

        let signing_key = deterministic_signing_key();
        let verifying_key = signing_key.verifying_key();
        let owner_pk = verifying_key.to_bytes();
        let owner_address = bs58::encode(&owner_pk).into_string();

        // Set current nonce to 5
        contract.owner_nonce.insert(owner_pk, 5);

        let action_json = format!(
            r#"{{"type":"CreateVault","owner":"{}","vault_address":"{}","policy":{{"per_tx_limit":[],"daily_cap":[],"programs":[],"max_priority_fee_lamports":"1000000","max_memo_len":100,"expires_at_ns":"999999999999999999","loosen_delay_ns":"3600000000000"}}}}"#,
            owner_address, owner_address
        );

        // Try nonce 3 (lower than 5)
        let message = build_admin_message(
            "near-testnet",
            env::current_account_id().as_ref(),
            None,
            3,
            env::block_timestamp() + 300_000_000_000,
            &action_json,
        );

        let signature = sign_message(&signing_key, &message);

        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .signer_account_pk(make_public_key(owner_pk))
            .attached_deposit(NearToken::from_near(1))
            .prepaid_gas(Gas::from_tgas(300))
            .build();
        testing_env!(context);

        contract.owner_action(message, signature);
    }

    #[test]
    #[should_panic(expected = "invalid signature")]
    fn test_non_owner_key_on_other_vault() {
        let mut contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            accounts(0),
        );

        let owner_key = deterministic_signing_key();
        let owner_verifying = owner_key.verifying_key();
        let owner_pk = owner_verifying.to_bytes();

        let attacker_key = second_key();
        let attacker_verifying = attacker_key.verifying_key();
        let attacker_pk = attacker_verifying.to_bytes();

        // Create vault owned by owner_key
        let vault = Vault::new(
            0,
            owner_pk,
            [1u8; 32],
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
        contract.vaults.insert(0, vault);
        contract.next_vault_id = 1;

        // Attacker tries to pause owner's vault
        let action_json = r#"{"type":"Pause","vault_id":0}"#;

        let message = build_admin_message(
            "near-testnet",
            env::current_account_id().as_ref(),
            Some(0),
            1,
            env::block_timestamp() + 300_000_000_000,
            action_json,
        );

        let signature = sign_message(&attacker_key, &message);

        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .signer_account_pk(make_public_key(attacker_pk))
            .attached_deposit(NearToken::from_yoctonear(1))
            .prepaid_gas(Gas::from_tgas(300))
            .build();
        testing_env!(context);

        contract.owner_action(message, signature);
    }

    #[test]
    fn test_valid_pause() {
        let mut contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            accounts(0),
        );

        let signing_key = deterministic_signing_key();
        let verifying_key = signing_key.verifying_key();
        let owner_pk = verifying_key.to_bytes();

        // Create vault
        let vault = Vault::new(
            0,
            owner_pk,
            [1u8; 32],
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
        contract.vaults.insert(0, vault);
        contract.next_vault_id = 1;

        let action_json = r#"{"type":"Pause","vault_id":0}"#;

        let message = build_admin_message(
            "near-testnet",
            env::current_account_id().as_ref(),
            Some(0),
            1,
            env::block_timestamp() + 300_000_000_000,
            action_json,
        );

        let signature = sign_message(&signing_key, &message);

        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .signer_account_pk(make_public_key(owner_pk))
            .attached_deposit(NearToken::from_yoctonear(1))
            .prepaid_gas(Gas::from_tgas(300))
            .build();
        testing_env!(context);

        let result = contract.owner_action(message, signature);
        assert!(result.contains("paused"));

        let vault = contract.vaults.get(&0).unwrap();
        assert!(vault.paused);
    }

    #[test]
    fn test_valid_set_policy() {
        let mut contract = Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            accounts(0),
        );

        let signing_key = deterministic_signing_key();
        let verifying_key = signing_key.verifying_key();
        let owner_pk = verifying_key.to_bytes();

        // Create vault
        let vault = Vault::new(
            0,
            owner_pk,
            [1u8; 32],
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
        contract.vaults.insert(0, vault);
        contract.next_vault_id = 1;

        let action_json = r#"{"type":"SetPolicy","vault_id":0,"policy":{"per_tx_limit":[],"daily_cap":[],"programs":[],"max_priority_fee_lamports":"2000000","max_memo_len":200,"expires_at_ns":"999999999999999999","loosen_delay_ns":"7200000000000"}}"#;

        let message = build_admin_message(
            "near-testnet",
            env::current_account_id().as_ref(),
            Some(0),
            1,
            env::block_timestamp() + 300_000_000_000,
            action_json,
        );

        let signature = sign_message(&signing_key, &message);

        let context = VMContextBuilder::new()
            .predecessor_account_id(accounts(1))
            .signer_account_pk(make_public_key(owner_pk))
            .attached_deposit(NearToken::from_yoctonear(1))
            .prepaid_gas(Gas::from_tgas(300))
            .build();
        testing_env!(context);

        let result = contract.owner_action(message, signature);
        // Policy loosen is scheduled, not immediate
        assert!(result.contains("scheduled") || result.contains("loosen"));

        // The policy is in pending_loosen, not yet applied
        let vault = contract.vaults.get(&0).unwrap();
        assert!(vault.pending_loosen.is_some());
        let (pending_policy, _effective_ns) = vault.pending_loosen.as_ref().unwrap();
        assert_eq!(pending_policy.max_priority_fee_lamports.0, 2_000_000);
        assert_eq!(pending_policy.max_memo_len, 200);
    }
}
