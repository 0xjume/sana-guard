// Tests for F1-F4 fixes from testnet followup
use crate::*;
use near_sdk::base64::Engine;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;
use near_sdk::{env, NearToken, PublicKey};

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

// F1: Test minimum agent funding is 0.15 NEAR
#[test]
#[should_panic(expected = "gas_funding below minimum")]
fn test_f1_agent_funding_below_minimum() {
    let (mut context, mut contract) = setup_contract();

    // Create a vault first using the execute_owner_action helper
    let owner_key = [7u8; 32];
    let vault_key = [9u8; 32];
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

    // Try to add agent with funding below 0.15 NEAR (minimum is now 0.15 NEAR)
    let public_key: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap();

    let add_agent_action = owner::OwnerAction::AddAgent {
        vault_id: 0,
        name: "agent1".to_string(),
        public_key,
        gas_funding: near_sdk::json_types::U128(100_000_000_000_000_000_000_000u128), // 0.1 NEAR, below 0.15
    };

    contract.execute_owner_action(owner_key, add_agent_action);
}

#[test]
fn test_f1_agent_funding_at_minimum() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = [7u8; 32];
    let vault_key = [9u8; 32];
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

    // Add agent with exactly 0.15 NEAR - should succeed
    let public_key: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap();

    context.attached_deposit(NearToken::from_near(1)); // Cover agent creation + storage
    testing_env!(context.build());

    let add_agent_action = owner::OwnerAction::AddAgent {
        vault_id: 0,
        name: "agent1".to_string(),
        public_key,
        gas_funding: near_sdk::json_types::U128(150_000_000_000_000_000_000_000u128), // 0.15 NEAR
    };

    let result = contract.execute_owner_action(owner_key, add_agent_action);
    assert!(result.contains("agent1 creation initiated"));
}

// F2: Test priority fee rounding and base fee
#[test]
fn test_f2_priority_fee_rounds_up() {
    use crate::parser::{
        calculate_spend, parse_solana_message, COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM,
    };

    // Build a transaction with:
    // - System transfer of 1000 lamports
    // - SetComputeUnitLimit 200000
    // - SetComputeUnitPrice 50
    // Priority fee = (200000 * 50 + 999_999) / 1_000_000 = (10_000_000 + 999_999) / 1_000_000 = 10 lamports
    // Plus 5000 lamport base fee = 5010 lamports total
    // Plus 1000 lamport transfer = 6010 lamports total

    let vault_addr = [1u8; 32];
    let recipient = [2u8; 32];

    let mut msg = vec![
        1, // 1 required signature
        0, // 0 readonly signed
        2, // 2 readonly unsigned
        4, // 4 keys
    ];
    msg.extend_from_slice(&vault_addr); // fee payer
    msg.extend_from_slice(&recipient); // recipient
    msg.extend_from_slice(&SYSTEM_PROGRAM); // System program
    msg.extend_from_slice(&COMPUTE_BUDGET_PROGRAM); // ComputeBudget program
    msg.extend_from_slice(&[0u8; 32]); // recent blockhash
    msg.push(3); // 3 instructions

    // ComputeBudgetSetLimit instruction (200000)
    msg.push(3); // program_id_index = 3 (ComputeBudget)
    msg.push(0); // 0 accounts
    msg.push(5); // data length = 5
    msg.push(2); // discriminator = 2 (SetLimit)
    msg.extend_from_slice(&200000u32.to_le_bytes()); // limit = 200000

    // ComputeBudgetSetPrice instruction (50)
    msg.push(3); // program_id_index = 3 (ComputeBudget)
    msg.push(0); // 0 accounts
    msg.push(9); // data length = 9
    msg.push(3); // discriminator = 3 (SetPrice)
    msg.extend_from_slice(&50u64.to_le_bytes()); // price = 50 micro-lamports

    // SystemTransfer instruction (1000 lamports)
    msg.push(2); // program_id_index = 2 (System)
    msg.push(2); // 2 accounts
    msg.push(0); // account 0 (vault, writable signer)
    msg.push(1); // account 1 (recipient, writable)
    msg.push(12); // data length = 12
    msg.extend_from_slice(&2u32.to_le_bytes()); // instruction discriminator = 2 (Transfer)
    msg.extend_from_slice(&1000u64.to_le_bytes()); // amount = 1000 lamports

    let parsed = parse_solana_message(&msg).unwrap();
    assert_eq!(parsed.instructions.len(), 3);

    let spend = calculate_spend(&parsed.instructions, &vault_addr).unwrap();

    // Find SOL spend
    let sol_spend = spend
        .iter()
        .find(|(m, _)| matches!(m, crate::types::Mint::Sol))
        .map(|(_, a)| *a)
        .unwrap_or(0);

    // Should be 6010 lamports:
    // - 1000 lamport transfer
    // - 10 lamports priority fee (rounded up from (200000 * 50) / 1_000_000)
    // - 5000 lamports base fee
    assert_eq!(sol_spend, 6010);
}

// F3a Tests: MPC vault verification

#[test]
fn test_f3a_vault_pending_after_creation() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = [7u8; 32];
    let vault_key = [9u8; 32];
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
    let result = contract.execute_owner_action(owner_key, create_action);
    assert!(result.contains("vault 0 creation initiated"));

    // Vault should exist but in PendingVerification state
    let vault_view = contract.get_vault(0).expect("vault should exist");
    assert_eq!(vault_view.state, types::VaultState::PendingVerification);
}

#[test]
#[should_panic(expected = "SG_E076_VAULT_NOT_ACTIVE")]
fn test_f3a_request_sign_on_pending_vault() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = [7u8; 32];
    let vault_key = [9u8; 32];
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

    // Add agent (vault is still pending)
    let public_key: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap();
    context.attached_deposit(NearToken::from_near(1));
    testing_env!(context.build());

    let add_agent_action = owner::OwnerAction::AddAgent {
        vault_id: 0,
        name: "agent1".to_string(),
        public_key,
        gas_funding: near_sdk::json_types::U128(150_000_000_000_000_000_000_000u128),
    };
    contract.execute_owner_action(owner_key, add_agent_action);

    // Manually complete agent creation
    let agent_id: AccountId = format!("agent1.{}", env::current_account_id())
        .parse()
        .unwrap();
    if let Some(mut vault) = contract.vaults.remove(&0) {
        vault.agents.push(agent_id.clone());
        contract.vaults.insert(0, vault);
        contract.agent_to_vault.insert(agent_id.clone(), 0);
    }

    // Try to request sign - should panic with SG_E076_VAULT_NOT_ACTIVE
    let tx_bytes = hex::decode("0100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010001031234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000102020000000c02000000e803000000000000").unwrap();

    context.predecessor_account_id(agent_id);
    context.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(context.build());

    #[allow(unused_must_use)]
    {
        contract.process_sign_request(
            0,
            near_sdk::base64::engine::general_purpose::STANDARD.encode(&tx_bytes),
            "abcd".repeat(8),
        );
    }
}

#[test]
fn test_f3a_vault_activated_on_match() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = [7u8; 32];
    let vault_key = [9u8; 32];
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

    // Simulate successful MPC callback with matching key
    context.predecessor_account_id(env::current_account_id());
    testing_env!(context.build());
    let result = Ok(format!("ed25519:{}", vault_b58));
    contract.on_vault_verified(
        0,
        accounts(0),
        NearToken::from_yoctonear(owner::VAULT_STORAGE_COST),
        result,
    );

    // Vault should now be Active
    let vault_view = contract.get_vault(0).expect("vault should exist");
    assert_eq!(vault_view.state, types::VaultState::Active);
}

#[test]
fn test_f3a_vault_removed_on_mismatch() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = [7u8; 32];
    let vault_key = [9u8; 32];
    let wrong_key = [10u8; 32]; // Different key
    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_b58 = bs58::encode(&vault_key).into_string();
    let wrong_b58 = bs58::encode(&wrong_key).into_string();

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

    // Simulate MPC callback with mismatched key
    context.predecessor_account_id(env::current_account_id());
    testing_env!(context.build());
    let result = Ok(format!("ed25519:{}", wrong_b58));
    contract.on_vault_verified(
        0,
        accounts(0),
        NearToken::from_yoctonear(owner::VAULT_STORAGE_COST),
        result,
    );

    // Vault should be removed
    assert!(contract.get_vault(0).is_none());
}

// Test that max_total_priority_fee_lamports is persisted (F3c security fix)
#[test]
fn test_f3c_max_total_priority_fee_persists() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = [7u8; 32];
    let vault_key = [9u8; 32];
    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    let policy = types::Policy {
        per_tx_limit: vec![],
        daily_cap: vec![],
        programs: vec![],
        max_priority_fee_lamports: near_sdk::json_types::U64(1_000_000),
        max_total_priority_fee_lamports: Some(near_sdk::json_types::U64(5_000_000)), // Set cap
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
    contract.activate_vault_for_test(0);

    // Read vault back and check the cap is preserved
    let vault_view = contract.get_vault(0).expect("vault should exist");
    assert_eq!(
        vault_view.policy.max_total_priority_fee_lamports,
        Some(near_sdk::json_types::U64(5_000_000))
    );
}

// F4 Test: get_recipients with pagination
#[test]
fn test_f4_get_recipients_pagination() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = [7u8; 32];
    let vault_key = [9u8; 32];
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
    contract.activate_vault_for_test(0);

    // Add multiple recipients
    for i in 0..5 {
        let mut recipient = [0u8; 32];
        recipient[0] = i;
        let add_recipient_action = owner::OwnerAction::AddRecipient {
            vault_id: 0,
            recipient: bs58::encode(&recipient).into_string(),
        };
        contract.execute_owner_action(owner_key, add_recipient_action);
    }

    // Get all recipients
    let all_recipients = contract.get_recipients(0, None, None);
    assert_eq!(all_recipients.len(), 5);

    // Get paginated (first 2)
    let page1 = contract.get_recipients(0, Some(0), Some(2));
    assert_eq!(page1.len(), 2);

    // Get paginated (next 2)
    let page2 = contract.get_recipients(0, Some(2), Some(2));
    assert_eq!(page2.len(), 2);

    // Get paginated (last 1)
    let page3 = contract.get_recipients(0, Some(4), Some(2));
    assert_eq!(page3.len(), 1);
}
