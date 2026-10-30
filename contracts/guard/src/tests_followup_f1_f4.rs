// Tests for F1-F4 fixes from testnet followup
use crate::*;
use near_sdk::base64::Engine;
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
#[ignore] // TODO: Fix transaction parsing - needs valid test transaction
fn test_f2_priority_fee_rounds_up() {
    use crate::parser::{calculate_spend, parse_solana_message};

    // Transaction with SetComputeUnitLimit 200000 and SetComputeUnitPrice 50
    // Priority fee = (200000 * 50 + 999_999) / 1_000_000 = (10_000_000 + 999_999) / 1_000_000 = 10 lamports (rounds up from 10.0)
    // Plus 5000 lamport base fee = 5010 lamports total

    let tx_with_priority = hex::decode("01000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100020420d0711a0dfc0c7a305b5c6b175f69d6aa6ccbc3a72e8305b9bc83ef7ba1d3bd000000000000000000000000000000000000000000000000000000000000000003061fddd6f60fb4e84e02c8dc74c5a21a49eeeb10d40f9c106f66e30e3febd93006ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a903000306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a4000000000020d090300000000000306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000000503320000000000000000000000").unwrap();

    let vault_address = [42u8; 32];
    let parsed = parse_solana_message(&tx_with_priority).unwrap();
    let spend = calculate_spend(&parsed.instructions, &vault_address).unwrap();

    // Find SOL spend
    let sol_spend = spend
        .iter()
        .find(|(m, _)| matches!(m, Mint::Sol))
        .map(|(_, a)| *a)
        .unwrap_or(0);

    // Should be 5010 lamports (10 rounded up priority fee + 5000 base fee)
    assert_eq!(sol_spend, 5010);
}

// F3b: Test program allowlist enforcement
#[test]
#[ignore] // TODO: Fix test - needs proper vault setup for process_sign_request
#[should_panic(expected = "SG_E074_PROGRAM_NOT_IN_POLICY")]
fn test_f3b_program_not_in_allowlist() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = [7u8; 32];
    let vault_key = [9u8; 32];
    let owner_b58 = bs58::encode(&owner_key).into_string();
    let vault_b58 = bs58::encode(&vault_key).into_string();

    // Policy that only allows System Program
    let system_program_b58 = bs58::encode(&parser::SYSTEM_PROGRAM).into_string();
    let policy = types::Policy {
        per_tx_limit: vec![],
        daily_cap: vec![],
        programs: vec![system_program_b58], // Only System Program allowed
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

    // Create agent
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

    // Manually add the agent to the vault (simulate successful callback)
    let agent_id: AccountId = format!("agent1.{}", env::current_account_id())
        .parse()
        .unwrap();
    if let Some(mut vault) = contract.vaults.remove(&0) {
        vault.agents.push(agent_id.clone());
        vault.recipients.insert([0u8; 32]); // Add a recipient
        contract.vaults.insert(0, vault);
        contract.agent_to_vault.insert(agent_id.clone(), 0);
    }

    // Try to sign a transaction with Memo program (which is supported but not in policy)
    // This transaction has a Memo instruction
    let memo_tx = hex::decode("01000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100010320d0711a0dfc0c7a305b5c6b175f69d6aa6ccbc3a72e8305b9bc83ef7ba1d3bd006ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a900000000000000000001080b68656c6c6f20776f726c64").unwrap();

    context.predecessor_account_id(agent_id);
    context.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(context.build());

    #[allow(unused_must_use)]
    {
        contract.process_sign_request(
            0,
            near_sdk::base64::engine::general_purpose::STANDARD.encode(&memo_tx),
            "abcd".repeat(8),
        );
    }
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
#[should_panic(expected = "SG_E075_VAULT_NOT_ACTIVE")]
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

    // Try to request sign - should panic with SG_E075_VAULT_NOT_ACTIVE
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
    let result = Ok(vault_b58.clone());
    contract.on_vault_verified(0, result);

    // Vault should now be Active
    let vault_view = contract.get_vault(0).expect("vault should exist");
    assert_eq!(vault_view.state, types::VaultState::Active);
}

#[test]
fn test_f3a_vault_removed_on_mismatch() {
    let (mut context, mut contract) = setup_contract();

    let owner_key = [7u8; 32];
    let vault_key = [9u8; 32];
    let wrong_key = [10u8; 32];  // Different key
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
    let result = Ok(wrong_b58);
    contract.on_vault_verified(0, result);

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
        max_total_priority_fee_lamports: Some(near_sdk::json_types::U64(5_000_000)),  // Set cap
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
    assert_eq!(vault_view.policy.max_total_priority_fee_lamports, Some(near_sdk::json_types::U64(5_000_000)));
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
