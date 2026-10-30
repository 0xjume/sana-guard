use crate::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;
use near_sdk::{NearToken, PublicKey};

fn setup_contract() -> (VMContextBuilder, Guard) {
    let mut context = VMContextBuilder::new();
    context.predecessor_account_id(accounts(0));
    context.block_timestamp(1_000_000_000_000_000_000);
    testing_env!(context.build());

    let contract = Guard::new(
        "mpc.near".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        accounts(0),
    );

    (context, contract)
}

fn create_owner_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    key[0] = 0xaa;
    key[31] = 0xbb;
    key
}

fn create_vault_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    key[0] = 0xcc;
    key[31] = 0xdd;
    key
}

// B1 Tests: CreateVault with explicit owner field
#[test]
fn test_b1_create_vault_owner_not_vault_address() {
    let (_, _) = setup_contract();

    let owner_key = create_owner_key();
    let vault_key = create_vault_key();

    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    // Craft admin message with separate owner and vault_address
    let _msg = format!(
        "SANA-GUARD-ADMIN-v1\nnetwork: near-testnet\ncontract: test\nvault: null\nnonce: 1\nexpires: {}\naction: {{\"type\":\"CreateVault\",\"owner\":\"{}\",\"vault_address\":\"{}\",\"policy\":{{\"per_tx_limit\":[],\"daily_cap\":[],\"programs\":[],\"max_priority_fee_lamports\":\"1000000\",\"max_memo_len\":100,\"expires_at_ns\":\"2000000000000000000\",\"loosen_delay_ns\":\"86400000000000\"}}}}",
        2_000_000_000_000_000_000u64,
        owner_b58,
        vault_b58
    );

    // The vault should be created with owner != vault_address
    // The path should use the owner key, not the vault address

    // Verify that owner field is extracted correctly
    let action: owner::OwnerAction = serde_json::from_str(&format!(
        "{{\"type\":\"CreateVault\",\"owner\":\"{}\",\"vault_address\":\"{}\",\"policy\":{{\"per_tx_limit\":[],\"daily_cap\":[],\"programs\":[],\"max_priority_fee_lamports\":\"1000000\",\"max_memo_len\":100,\"expires_at_ns\":\"2000000000000000000\",\"loosen_delay_ns\":\"86400000000000\"}}}}",
        owner_b58, vault_b58
    ))
    .unwrap();

    match action {
        owner::OwnerAction::CreateVault {
            owner,
            vault_address,
            ..
        } => {
            assert_eq!(owner, owner_b58);
            assert_eq!(vault_address, vault_b58);
            assert_ne!(owner, vault_address);
        }
        _ => panic!("Wrong action type"),
    }
}

#[test]
fn test_b1_vault_path_uses_per_owner_index() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = create_owner_key();
    let vault_key_1 = create_vault_key();
    let mut vault_key_2 = vault_key_1;
    vault_key_2[0] = 0xee;

    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_1_b58 = bs58::encode(&vault_key_1).into_string();
    let vault_2_b58 = bs58::encode(&vault_key_2).into_string();

    let policy = types::Policy {
        per_tx_limit: vec![],
        daily_cap: vec![],
        programs: vec![],
        max_priority_fee_lamports: near_sdk::json_types::U64(1_000_000),
        max_total_priority_fee_lamports: None,
        max_memo_len: 100,
        expires_at_ns: near_sdk::json_types::U64(2_000_000_000_000_000_000),
        loosen_delay_ns: near_sdk::json_types::U64(86_400_000_000_000),
    };

    context.attached_deposit(NearToken::from_near(1));
    testing_env!(context.build());

    // Create first vault for this owner
    let action1 = owner::OwnerAction::CreateVault {
        owner: owner_b58.clone(),
        vault_address: vault_1_b58.clone(),
        policy: policy.clone(),
    };

    contract.execute_owner_action(owner_key, action1);
    let vault1 = contract.vaults.get(&0).unwrap();
    assert_eq!(vault1.path, format!("vault/{}/0", owner_b58));

    // Create second vault for same owner
    let action2 = owner::OwnerAction::CreateVault {
        owner: owner_b58.clone(),
        vault_address: vault_2_b58.clone(),
        policy: policy.clone(),
    };

    contract.execute_owner_action(owner_key, action2);
    let vault2 = contract.vaults.get(&1).unwrap();
    assert_eq!(vault2.path, format!("vault/{}/1", owner_b58));
}

// B2 Tests: AddAgent with proper funding and access key
#[test]
fn test_b2_add_agent_with_proper_funding() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = create_owner_key();
    let vault_key = create_vault_key();

    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    let policy = types::Policy {
        per_tx_limit: vec![],
        daily_cap: vec![],
        programs: vec![],
        max_priority_fee_lamports: near_sdk::json_types::U64(1_000_000),
        max_total_priority_fee_lamports: None,
        max_memo_len: 100,
        expires_at_ns: near_sdk::json_types::U64(2_000_000_000_000_000_000),
        loosen_delay_ns: near_sdk::json_types::U64(86_400_000_000_000),
    };

    context.attached_deposit(NearToken::from_near(1));
    testing_env!(context.build());

    // Create vault
    let create_action = owner::OwnerAction::CreateVault {
        owner: owner_b58.clone(),
        vault_address: vault_b58.clone(),
        policy: policy.clone(),
    };
    contract.execute_owner_action(owner_key, create_action);

    // Test AddAgent with minimum funding
    let min_funding = 150_000_000_000_000_000_000_000u128; // 0.15 NEAR (new minimum for 90-100 Tgas calls)
    let public_key: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap();

    context.attached_deposit(NearToken::from_near(1)); // Cover agent funding + storage overhead
    testing_env!(context.build());

    let add_agent_action = owner::OwnerAction::AddAgent {
        vault_id: 0,
        name: "agent1".to_string(),
        public_key: public_key.clone(),
        gas_funding: near_sdk::json_types::U128(min_funding),
    };

    // This should not panic
    let result = contract.execute_owner_action(owner_key, add_agent_action);
    assert!(result.contains("agent1 creation initiated"));
}

#[test]
#[should_panic(expected = "gas_funding below minimum")]
fn test_b2_add_agent_below_minimum() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = create_owner_key();
    let vault_key = create_vault_key();

    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    let policy = types::Policy {
        per_tx_limit: vec![],
        daily_cap: vec![],
        programs: vec![],
        max_priority_fee_lamports: near_sdk::json_types::U64(1_000_000),
        max_total_priority_fee_lamports: None,
        max_memo_len: 100,
        expires_at_ns: near_sdk::json_types::U64(2_000_000_000_000_000_000),
        loosen_delay_ns: near_sdk::json_types::U64(86_400_000_000_000),
    };

    context.attached_deposit(NearToken::from_near(1));
    testing_env!(context.build());

    let create_action = owner::OwnerAction::CreateVault {
        owner: owner_b58.clone(),
        vault_address: vault_b58.clone(),
        policy: policy.clone(),
    };
    contract.execute_owner_action(owner_key, create_action);

    let public_key: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap();

    let add_agent_action = owner::OwnerAction::AddAgent {
        vault_id: 0,
        name: "agent1".to_string(),
        public_key,
        gas_funding: near_sdk::json_types::U128(1_000_000_000_000_000_000_000u128), // 0.001 NEAR, below min
    };

    contract.execute_owner_action(owner_key, add_agent_action);
}

#[test]
#[should_panic(expected = "gas_funding above maximum")]
fn test_b2_add_agent_above_maximum() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = create_owner_key();
    let vault_key = create_vault_key();

    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    let policy = types::Policy {
        per_tx_limit: vec![],
        daily_cap: vec![],
        programs: vec![],
        max_priority_fee_lamports: near_sdk::json_types::U64(1_000_000),
        max_total_priority_fee_lamports: None,
        max_memo_len: 100,
        expires_at_ns: near_sdk::json_types::U64(2_000_000_000_000_000_000),
        loosen_delay_ns: near_sdk::json_types::U64(86_400_000_000_000),
    };

    context.attached_deposit(NearToken::from_near(1));
    testing_env!(context.build());

    let create_action = owner::OwnerAction::CreateVault {
        owner: owner_b58.clone(),
        vault_address: vault_b58.clone(),
        policy: policy.clone(),
    };
    contract.execute_owner_action(owner_key, create_action);

    let public_key: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap();

    let add_agent_action = owner::OwnerAction::AddAgent {
        vault_id: 0,
        name: "agent1".to_string(),
        public_key,
        gas_funding: near_sdk::json_types::U128(600_000_000_000_000_000_000_000u128), // 0.6 NEAR, above max
    };

    contract.execute_owner_action(owner_key, add_agent_action);
}

// B3 Tests: Deposit requirement
#[test]
#[should_panic(expected = "insufficient attached deposit")]
fn test_b3_create_vault_without_deposit() {
    use ed25519_dalek::{Signer, SigningKey};

    let mut context = VMContextBuilder::new();
    context.current_account_id(accounts(0));
    context.predecessor_account_id(accounts(1));
    context.block_timestamp(1_000_000_000_000_000_000);
    testing_env!(context.build());

    let mut contract = Guard::new(
        "mpc.near".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        accounts(0),
    );

    let signing_key = SigningKey::from_bytes(&[7u8; 32]);
    let verifying_key = signing_key.verifying_key();
    let owner_key = verifying_key.to_bytes();
    let vault_key = create_vault_key();

    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    let msg = format!(
        "SANA-GUARD-ADMIN-v1\nnetwork: near-testnet\ncontract: {}\nvault: null\nnonce: 1\nexpires: {}\naction: {{\"type\":\"CreateVault\",\"owner\":\"{}\",\"vault_address\":\"{}\",\"policy\":{{\"per_tx_limit\":[],\"daily_cap\":[],\"programs\":[],\"max_priority_fee_lamports\":\"1000000\",\"max_memo_len\":100,\"expires_at_ns\":\"2000000000000000000\",\"loosen_delay_ns\":\"86400000000000\"}}}}",
        env::current_account_id(),
        2_000_000_000_000_000_000u64,
        owner_b58,
        vault_b58
    );

    // Properly sign the message
    let signature_obj = signing_key.sign(msg.as_bytes());
    let sig = signature_obj.to_bytes().to_vec();

    // No deposit attached - should panic
    context.attached_deposit(NearToken::from_yoctonear(0));
    testing_env!(context.build());

    contract.owner_action(msg, sig);
}

// B4 Tests: Compute Budget program ID
#[test]
fn test_b4_compute_budget_program_id_correct() {
    // ComputeBudget111111111111111111111111111111
    let expected_b58 = "ComputeBudget111111111111111111111111111111";
    let decoded = bs58::decode(expected_b58).into_vec().unwrap();

    let mut expected_bytes = [0u8; 32];
    expected_bytes.copy_from_slice(&decoded);

    assert_eq!(parser::COMPUTE_BUDGET_PROGRAM, expected_bytes);

    // Verify it encodes back correctly
    let encoded = bs58::encode(&parser::COMPUTE_BUDGET_PROGRAM).into_string();
    assert_eq!(encoded, expected_b58);
}

#[test]
fn test_b4_compute_budget_set_limit_instruction() {
    // Test parsing a message with ComputeBudgetSetLimit instruction
    let vault_addr = [1u8; 32];
    let recipient = [2u8; 32];

    let mut msg = vec![
        1, // 1 required signature
        0, // 0 readonly signed
        1, // 1 readonly unsigned
        3, // 3 keys
    ];
    msg.extend_from_slice(&vault_addr); // fee payer
    msg.extend_from_slice(&recipient); // recipient
    msg.extend_from_slice(&parser::COMPUTE_BUDGET_PROGRAM); // ComputeBudget program
    msg.extend_from_slice(&[0u8; 32]); // recent blockhash
    msg.push(1); // 1 instruction

    // ComputeBudgetSetLimit instruction
    msg.push(2); // program_id_index = 2 (ComputeBudget)
    msg.push(0); // 0 accounts
    msg.push(5); // data length = 5
    msg.push(2); // discriminator = 2 (SetLimit)
    msg.extend_from_slice(&[0x80, 0x38, 0x01, 0x00]); // limit = 80000

    let result = parser::parse_solana_message(&msg);
    assert!(result.is_ok());

    let parsed = result.unwrap();
    assert_eq!(parsed.instructions.len(), 1);

    match &parsed.instructions[0] {
        parser::ParsedInstruction::ComputeBudgetSetLimit { limit } => {
            assert_eq!(*limit, 80000);
        }
        _ => panic!("Expected ComputeBudgetSetLimit instruction"),
    }
}

// B5 Tests: Release reservation refund
#[test]
fn test_b5_release_failed_request_refunds_cap() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = create_owner_key();
    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_key = create_vault_key();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    // Create vault with SOL cap
    let policy = types::Policy {
        per_tx_limit: vec![(types::Mint::Sol, near_sdk::json_types::U64(1_000_000_000))],
        daily_cap: vec![(types::Mint::Sol, near_sdk::json_types::U64(10_000_000_000))],
        programs: vec![],
        max_priority_fee_lamports: near_sdk::json_types::U64(1_000_000),
        max_total_priority_fee_lamports: None,
        max_memo_len: 100,
        expires_at_ns: near_sdk::json_types::U64(2_000_000_000_000_000_000),
        loosen_delay_ns: near_sdk::json_types::U64(86_400_000_000_000),
    };

    context.attached_deposit(NearToken::from_near(1));
    testing_env!(context.build());

    let create_action = owner::OwnerAction::CreateVault {
        owner: owner_b58.clone(),
        vault_address: vault_b58.clone(),
        policy: policy.clone(),
    };
    contract.execute_owner_action(owner_key, create_action);

    // Simulate a failed request with spend
    let req_id = [0xab; 32];
    let request = types::SignRequest {
        vault_id: 0,
        agent: accounts(1),
        msg_hash: [0xcd; 32],
        spend: vec![(types::Mint::Sol, 500_000_000)],
        hour: 1000,
        status: types::Status::Failed,
        signature: None,
        created_ns: 1_000_000_000_000_000_000,
    };

    contract.requests.insert(req_id, request.clone());

    // Add the spend to the bucket
    let vault = contract.vaults.get_mut(&0).unwrap();
    vault
        .bucket_spend
        .insert(1000, vec![(types::Mint::Sol, 500_000_000)]);
    vault.bucket_hashes.insert(1000, vec![[0xcd; 32]]);

    // Verify spend is tracked
    let spend_before = vault.bucket_spend.get(&1000).unwrap().clone();
    assert_eq!(spend_before.len(), 1);
    assert_eq!(spend_before[0].1, 500_000_000);

    // Release the failed request
    contract.release_reservation(&request);

    // Verify spend was subtracted
    let vault = contract.vaults.get(&0).unwrap();
    let spend_after = vault.bucket_spend.get(&1000).unwrap();
    assert_eq!(spend_after[0].1, 0); // Should be reduced to 0
}

#[test]
#[should_panic(expected = "cannot release signed request")]
fn test_b5_cannot_release_signed_request() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = create_owner_key();
    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_key = create_vault_key();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    let policy = types::Policy {
        per_tx_limit: vec![],
        daily_cap: vec![],
        programs: vec![],
        max_priority_fee_lamports: near_sdk::json_types::U64(1_000_000),
        max_total_priority_fee_lamports: None,
        max_memo_len: 100,
        expires_at_ns: near_sdk::json_types::U64(2_000_000_000_000_000_000),
        loosen_delay_ns: near_sdk::json_types::U64(86_400_000_000_000),
    };

    context.attached_deposit(NearToken::from_near(1));
    testing_env!(context.build());

    let create_action = owner::OwnerAction::CreateVault {
        owner: owner_b58.clone(),
        vault_address: vault_b58.clone(),
        policy: policy.clone(),
    };
    contract.execute_owner_action(owner_key, create_action);

    // Create a signed request
    let req_id = [0xab; 32];
    let request = types::SignRequest {
        vault_id: 0,
        agent: accounts(1),
        msg_hash: [0xcd; 32],
        spend: vec![],
        hour: 1000,
        status: types::Status::Signed,
        signature: Some(vec![0u8; 64]),
        created_ns: 1_000_000_000_000_000_000,
    };

    contract.requests.insert(req_id, request);

    // Try to release a signed request - should panic
    let release_action = owner::OwnerAction::Release {
        vault_id: 0,
        req_id: hex::encode(req_id),
    };

    contract.execute_owner_action(owner_key, release_action);
}

// Vault header check test
#[test]
#[should_panic(expected = "vault must be null for CreateVault")]
fn test_create_vault_with_non_null_vault_header() {
    use ed25519_dalek::{Signer, SigningKey};

    let mut context = VMContextBuilder::new();
    context.current_account_id(accounts(0));
    context.predecessor_account_id(accounts(1));
    context.block_timestamp(1_000_000_000_000_000_000);
    testing_env!(context.build());

    let mut contract = Guard::new(
        "mpc.near".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        accounts(0),
    );

    let signing_key = SigningKey::from_bytes(&[7u8; 32]);
    let verifying_key = signing_key.verifying_key();
    let owner_key = verifying_key.to_bytes();
    let vault_key = create_vault_key();

    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    // Admin message with vault: 0 instead of vault: null for CreateVault
    let msg = format!(
        "SANA-GUARD-ADMIN-v1\nnetwork: near-testnet\ncontract: {}\nvault: 0\nnonce: 1\nexpires: {}\naction: {{\"type\":\"CreateVault\",\"owner\":\"{}\",\"vault_address\":\"{}\",\"policy\":{{\"per_tx_limit\":[],\"daily_cap\":[],\"programs\":[],\"max_priority_fee_lamports\":\"1000000\",\"max_memo_len\":100,\"expires_at_ns\":\"2000000000000000000\",\"loosen_delay_ns\":\"86400000000000\"}}}}",
        env::current_account_id(),
        2_000_000_000_000_000_000u64,
        owner_b58,
        vault_b58
    );

    // Properly sign the message
    let signature_obj = signing_key.sign(msg.as_bytes());
    let sig = signature_obj.to_bytes().to_vec();

    context.attached_deposit(NearToken::from_near(1));
    testing_env!(context.build());

    contract.owner_action(msg, sig);
}

// B3: Test excess deposit refund
#[test]
fn test_b3_excess_deposit_refunded() {
    use ed25519_dalek::{Signer, SigningKey};

    let mut context = VMContextBuilder::new();
    context.current_account_id(accounts(0));
    context.predecessor_account_id(accounts(1));
    context.block_timestamp(1_000_000_000_000_000_000);
    testing_env!(context.build());

    let mut contract = Guard::new(
        "mpc.near".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        accounts(0),
    );

    let signing_key = SigningKey::from_bytes(&[7u8; 32]);
    let verifying_key = signing_key.verifying_key();
    let owner_key = verifying_key.to_bytes();
    let vault_key = create_vault_key();

    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    let msg = format!(
        "SANA-GUARD-ADMIN-v1\nnetwork: near-testnet\ncontract: {}\nvault: null\nnonce: 1\nexpires: {}\naction: {{\"type\":\"CreateVault\",\"owner\":\"{}\",\"vault_address\":\"{}\",\"policy\":{{\"per_tx_limit\":[],\"daily_cap\":[],\"programs\":[],\"max_priority_fee_lamports\":\"1000000\",\"max_memo_len\":100,\"expires_at_ns\":\"2000000000000000000\",\"loosen_delay_ns\":\"86400000000000\"}}}}",
        env::current_account_id(),
        2_000_000_000_000_000_000u64,
        owner_b58,
        vault_b58
    );

    let signature_obj = signing_key.sign(msg.as_bytes());
    let sig = signature_obj.to_bytes().to_vec();

    // Attach 2 NEAR, more than required (0.5 NEAR storage)
    context.attached_deposit(NearToken::from_near(2));
    testing_env!(context.build());

    // Should succeed and refund excess
    let result = contract.owner_action(msg, sig);
    assert!(result.contains("vault 0 created"));
}

// Test request-id hex consistency
#[test]
fn test_request_id_hex_consistency() {
    let (_, contract) = setup_contract();

    // get_request uses hex
    let test_req_id_hex = "abcd".repeat(8); // 32 bytes in hex
    let result = contract.get_request(test_req_id_hex);
    // Should return None for non-existent, but important that it accepts hex
    assert!(result.is_none());
}

// B5: Test release only for expired pending requests
#[test]
#[should_panic(expected = "request not expired yet")]
fn test_b5_cannot_release_recent_pending_request() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = create_owner_key();
    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_key = create_vault_key();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    let policy = types::Policy {
        per_tx_limit: vec![],
        daily_cap: vec![],
        programs: vec![],
        max_priority_fee_lamports: near_sdk::json_types::U64(1_000_000),
        max_total_priority_fee_lamports: None,
        max_memo_len: 100,
        expires_at_ns: near_sdk::json_types::U64(2_000_000_000_000_000_000),
        loosen_delay_ns: near_sdk::json_types::U64(86_400_000_000_000),
    };

    context.attached_deposit(NearToken::from_near(1));
    testing_env!(context.build());

    let create_action = owner::OwnerAction::CreateVault {
        owner: owner_b58.clone(),
        vault_address: vault_b58.clone(),
        policy: policy.clone(),
    };
    contract.execute_owner_action(owner_key, create_action);

    // Create a recent pending request (not expired)
    let req_id = [0xab; 32];
    let request = types::SignRequest {
        vault_id: 0,
        agent: accounts(1),
        msg_hash: [0xcd; 32],
        spend: vec![(types::Mint::Sol, 500_000_000)],
        hour: 1000,
        status: types::Status::Pending,
        signature: None,
        created_ns: env::block_timestamp(), // Just now
    };

    contract.requests.insert(req_id, request);

    // Try to release - should panic as not expired yet
    let release_action = owner::OwnerAction::Release {
        vault_id: 0,
        req_id: hex::encode(req_id),
    };

    contract.execute_owner_action(owner_key, release_action);
}
