// Behavioral tests for the three refund bugs found in relay review.
//
// Receipts created by Promise::transfer / Promise::function_call are inspected
// via near_sdk::test_utils::get_created_receipts(). Unit-test account_balance()
// is not updated by those promises, so refund proofs are the receipts themselves.

use crate::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{accounts, get_created_receipts, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, Gas, NearToken};

const VAULT_STORAGE_COST: u128 = owner::VAULT_STORAGE_COST;
const AGENT_STORAGE_OVERHEAD: u128 = owner::AGENT_STORAGE_OVERHEAD;
const MIN_AGENT_FUNDING: u128 = 150_000_000_000_000_000_000_000;
const AGENT_PUBLIC_KEY: &str = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";

fn owner_signing_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn owner_pubkey() -> [u8; 32] {
    owner_signing_key().verifying_key().to_bytes()
}

fn default_policy() -> types::Policy {
    types::Policy {
        per_tx_limit: vec![],
        daily_cap: vec![],
        programs: vec![],
        max_priority_fee_lamports: near_sdk::json_types::U64(1_000_000),
        max_total_priority_fee_lamports: None,
        max_memo_len: 100,
        expires_at_ns: near_sdk::json_types::U64(2_000_000_000_000_000_000),
        loosen_delay_ns: near_sdk::json_types::U64(86_400_000_000_000),
    }
}

fn init_contract(predecessor: AccountId) -> (VMContextBuilder, Guard) {
    let mut context = VMContextBuilder::new();
    context.current_account_id(accounts(0));
    context.predecessor_account_id(predecessor);
    context.block_timestamp(1_000_000_000_000_000_000);
    context.account_balance(NearToken::from_near(100));
    context.prepaid_gas(Gas::from_tgas(300));
    testing_env!(context.build());

    let contract = Guard::new(
        "mpc.near".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        accounts(0),
    );
    (context, contract)
}

fn create_and_activate_vault(contract: &mut Guard, context: &mut VMContextBuilder) -> [u8; 32] {
    let owner_key = owner_pubkey();
    let vault_key = [9u8; 32];
    context.attached_deposit(NearToken::from_yoctonear(VAULT_STORAGE_COST));
    testing_env!(context.build());

    contract.execute_owner_action(
        owner_key,
        owner::OwnerAction::CreateVault {
            owner: bs58::encode(&owner_key).into_string(),
            vault_address: bs58::encode(&vault_key).into_string(),
            policy: default_policy(),
        },
    );
    contract.activate_vault_for_test(0);
    owner_key
}

fn sign_admin(msg: &str) -> Vec<u8> {
    owner_signing_key().sign(msg.as_bytes()).to_bytes().to_vec()
}

fn add_agent_message(nonce: u64, gas_funding: u128) -> String {
    format!(
        "SANA-GUARD-ADMIN-v1\nnetwork: near-testnet\ncontract: {}\nvault: 0\nnonce: {}\nexpires: {}\naction: {{\"type\":\"AddAgent\",\"vault_id\":0,\"name\":\"agent1\",\"public_key\":\"{}\",\"gas_funding\":\"{}\"}}",
        env::current_account_id(),
        nonce,
        2_000_000_000_000_000_000u64,
        AGENT_PUBLIC_KEY,
        gas_funding
    )
}

fn create_vault_message(nonce: u64, vault_address: &str) -> String {
    let owner_b58 = bs58::encode(&owner_pubkey()).into_string();
    format!(
        "SANA-GUARD-ADMIN-v1\nnetwork: near-testnet\ncontract: {}\nvault: null\nnonce: {}\nexpires: {}\naction: {{\"type\":\"CreateVault\",\"owner\":\"{}\",\"vault_address\":\"{}\",\"policy\":{{\"per_tx_limit\":[],\"daily_cap\":[],\"programs\":[],\"max_priority_fee_lamports\":\"1000000\",\"max_memo_len\":100,\"expires_at_ns\":\"2000000000000000000\",\"loosen_delay_ns\":\"86400000000000\"}}}}",
        env::current_account_id(),
        nonce,
        2_000_000_000_000_000_000u64,
        owner_b58,
        vault_address
    )
}

fn transfer_amounts_to(account: &AccountId) -> Vec<u128> {
    get_created_receipts()
        .into_iter()
        .filter(|receipt| &receipt.receiver_id == account)
        .flat_map(|receipt| receipt.actions)
        .filter_map(|action| match action {
            MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
            _ => None,
        })
        .collect()
}

fn all_transfers() -> Vec<(AccountId, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|receipt| {
            receipt
                .actions
                .into_iter()
                .filter_map(move |action| match action {
                    MockAction::Transfer { deposit, .. } => {
                        Some((receipt.receiver_id.clone(), deposit.as_yoctonear()))
                    }
                    _ => None,
                })
        })
        .collect()
}

fn callback_args(method: &str) -> serde_json::Value {
    for receipt in get_created_receipts() {
        for action in receipt.actions {
            if let MockAction::FunctionCallWeight {
                method_name, args, ..
            } = action
            {
                if method_name == method.as_bytes() {
                    return serde_json::from_slice(&args).expect("callback args json");
                }
            }
        }
    }
    panic!("no {method} receipt");
}

fn agent_account() -> AccountId {
    format!("agent1.{}", env::current_account_id())
        .parse()
        .unwrap()
}

fn enter_callback_context(context: &mut VMContextBuilder) {
    context.predecessor_account_id(env::current_account_id());
    context.attached_deposit(NearToken::from_yoctonear(0));
    testing_env!(context.build());
}

fn register_live_agent(contract: &mut Guard, vault_id: u32, name: &str) -> AccountId {
    let agent_id: AccountId = format!("{}.{}", name, env::current_account_id())
        .parse()
        .unwrap();
    contract.on_agent_created(
        vault_id,
        name.to_string(),
        accounts(1),
        NearToken::from_yoctonear(0),
        Ok(()),
    );
    agent_id
}

fn agent_pk() -> near_sdk::PublicKey {
    AGENT_PUBLIC_KEY.parse().unwrap()
}

fn add_agent_action(vault_id: u32, name: &str) -> owner::OwnerAction {
    owner::OwnerAction::AddAgent {
        vault_id,
        name: name.to_string(),
        public_key: agent_pk(),
        gas_funding: near_sdk::json_types::U128(MIN_AGENT_FUNDING),
    }
}

fn create_second_vault(contract: &mut Guard, context: &mut VMContextBuilder) -> [u8; 32] {
    let owner_key = SigningKey::from_bytes(&[42u8; 32])
        .verifying_key()
        .to_bytes();
    let vault_key = [11u8; 32];
    context.attached_deposit(NearToken::from_yoctonear(VAULT_STORAGE_COST));
    testing_env!(context.build());
    contract.execute_owner_action(
        owner_key,
        owner::OwnerAction::CreateVault {
            owner: bs58::encode(&owner_key).into_string(),
            vault_address: bs58::encode(&vault_key).into_string(),
            policy: default_policy(),
        },
    );
    contract.activate_vault_for_test(1);
    owner_key
}

// ========================================================================
// (a) AddAgent excess must be refunded exactly once
// ========================================================================

#[test]
fn test_add_agent_excess_refunded_exactly_once() {
    let caller = accounts(1);
    let (mut context, mut contract) = init_contract(caller.clone());
    create_and_activate_vault(&mut contract, &mut context);

    let gas_funding = MIN_AGENT_FUNDING;
    let required = gas_funding + AGENT_STORAGE_OVERHEAD;
    let excess = NearToken::from_near(1).as_yoctonear();
    let attached = required + excess;

    context.predecessor_account_id(caller.clone());
    context.attached_deposit(NearToken::from_yoctonear(attached));
    testing_env!(context.build());

    let msg = add_agent_message(1, gas_funding);
    let sig = sign_admin(&msg);
    contract.owner_action(msg, sig);

    let refunds_to_caller = transfer_amounts_to(&caller);
    assert_eq!(
        refunds_to_caller,
        vec![excess],
        "caller must receive exactly one excess refund of {excess}, got {refunds_to_caller:?}"
    );

    let funding_to_agent = transfer_amounts_to(&agent_account());
    assert_eq!(
        funding_to_agent,
        vec![gas_funding],
        "agent subaccount must be funded exactly once with gas_funding"
    );

    let outgoing: u128 = all_transfers().iter().map(|(_, amount)| amount).sum();
    let kept_by_guard = attached - outgoing;
    assert_eq!(
        kept_by_guard, AGENT_STORAGE_OVERHEAD,
        "guard must keep only the 0.05 NEAR overhead (runtime storage is billed separately)"
    );

    let args = callback_args("on_agent_created");
    assert_eq!(args["original_caller"], caller.to_string());
    assert_eq!(args["deposit_amount"], required.to_string());

    assert!(
        outgoing <= attached,
        "owner_action refunded {outgoing} which exceeds attached {attached}"
    );
}

// ========================================================================
// (b) Failed vault verification must refund the original caller
// ========================================================================

#[test]
fn test_vault_verification_refunds_original_caller() {
    let caller = accounts(1);
    let (mut context, mut contract) = init_contract(caller.clone());

    let vault_key = [9u8; 32];
    let vault_b58 = bs58::encode(&vault_key).into_string();
    let attached = NearToken::from_near(2).as_yoctonear();

    context.predecessor_account_id(caller.clone());
    context.attached_deposit(NearToken::from_yoctonear(attached));
    testing_env!(context.build());

    let msg = create_vault_message(1, &vault_b58);
    let sig = sign_admin(&msg);
    contract.owner_action(msg, sig);

    let excess = attached - VAULT_STORAGE_COST;
    assert_eq!(
        transfer_amounts_to(&caller),
        vec![excess],
        "CreateVault must refund excess once to the predecessor, not twice"
    );

    let args = callback_args("on_vault_verified");
    assert_eq!(args["original_caller"], caller.to_string());
    assert_eq!(args["deposit_amount"], VAULT_STORAGE_COST.to_string());
    assert_ne!(
        args["original_caller"],
        env::current_account_id().to_string(),
        "callback must carry the original caller, not the guard account"
    );

    enter_callback_context(&mut context);
    assert_eq!(
        env::predecessor_account_id(),
        env::current_account_id(),
        "callback predecessor is the guard; refunds must not use it"
    );

    let wrong_b58 = bs58::encode(&[10u8; 32]).into_string();
    contract.on_vault_verified(
        0,
        caller.clone(),
        NearToken::from_yoctonear(VAULT_STORAGE_COST),
        Ok(wrong_b58),
    );

    assert!(contract.vaults.get(&0).is_none());

    let refunds = transfer_amounts_to(&caller);
    assert_eq!(
        refunds,
        vec![VAULT_STORAGE_COST],
        "failed verification must refund the 0.5 NEAR vault deposit to the original caller"
    );
    assert!(
        transfer_amounts_to(&env::current_account_id()).is_empty(),
        "must not refund the guard (the callback predecessor)"
    );
}

#[test]
fn test_vault_verification_mpc_error_refunds_original_caller() {
    let caller = accounts(1);
    let (mut context, mut contract) = init_contract(caller.clone());

    let vault_b58 = bs58::encode(&[9u8; 32]).into_string();
    context.predecessor_account_id(caller.clone());
    context.attached_deposit(NearToken::from_yoctonear(VAULT_STORAGE_COST));
    testing_env!(context.build());

    let msg = create_vault_message(1, &vault_b58);
    let sig = sign_admin(&msg);
    contract.owner_action(msg, sig);
    assert!(transfer_amounts_to(&caller).is_empty());

    enter_callback_context(&mut context);
    contract.on_vault_verified(
        0,
        caller.clone(),
        NearToken::from_yoctonear(VAULT_STORAGE_COST),
        Err(near_sdk::PromiseError::Failed),
    );

    assert!(contract.vaults.get(&0).is_none());
    assert_eq!(
        transfer_amounts_to(&caller),
        vec![VAULT_STORAGE_COST],
        "MPC failure must refund the original caller"
    );
    assert!(transfer_amounts_to(&env::current_account_id()).is_empty());
}

// ========================================================================
// (c) Failed create_account refunds; must not unregister a live agent
// ========================================================================

#[test]
fn test_add_agent_retry_create_account_failure_keeps_registration() {
    // agent1 is live in vault 0. The owner retries the same name; create_account
    // fails (account already exists). The failure callback must leave agent1
    // registered and refund exactly the required deposit once.
    let caller = accounts(1);
    let (mut context, mut contract) = init_contract(caller.clone());
    create_and_activate_vault(&mut contract, &mut context);

    enter_callback_context(&mut context);
    let agent_id = register_live_agent(&mut contract, 0, "agent1");
    assert!(contract.vaults.get(&0).unwrap().agents.contains(&agent_id));
    assert_eq!(contract.agent_to_vault.get(&agent_id), Some(&0));

    let required = MIN_AGENT_FUNDING + AGENT_STORAGE_OVERHEAD;
    enter_callback_context(&mut context);
    contract.on_agent_created(
        0,
        "agent1".to_string(),
        caller.clone(),
        NearToken::from_yoctonear(required),
        Err(near_sdk::PromiseError::Failed),
    );

    let vault = contract.vaults.get(&0).unwrap();
    assert!(
        vault.agents.contains(&agent_id),
        "failed retry must not unregister the live agent"
    );
    assert_eq!(contract.agent_to_vault.get(&agent_id), Some(&0));
    assert_eq!(
        transfer_amounts_to(&caller),
        vec![required],
        "failed create_account must refund gas_funding + 0.05 overhead once"
    );
    assert!(transfer_amounts_to(&env::current_account_id()).is_empty());
}

#[test]
fn test_add_agent_other_vault_cannot_unregister_victim() {
    // A different vault's owner reuses vault 0's agent name. AddAgent must
    // panic E077 before any promise, and vault 0's agent stays registered.
    let caller = accounts(1);
    let (mut context, mut contract) = init_contract(caller.clone());
    let vault0_owner = create_and_activate_vault(&mut contract, &mut context);

    enter_callback_context(&mut context);
    let agent_id = register_live_agent(&mut contract, 0, "agent1");

    let other_owner = create_second_vault(&mut contract, &mut context);
    assert_ne!(other_owner, vault0_owner);

    context.predecessor_account_id(accounts(2));
    context.attached_deposit(NearToken::from_yoctonear(
        MIN_AGENT_FUNDING + AGENT_STORAGE_OVERHEAD,
    ));
    context.prepaid_gas(Gas::from_tgas(50));
    testing_env!(context.build());

    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.execute_owner_action(other_owner, add_agent_action(1, "agent1"));
    }));
    let payload = panicked.expect_err("other vault must not reuse a live agent name");
    let msg = panic_message(&payload);
    assert!(
        msg.contains("SG_E077_AGENT_EXISTS"),
        "expected SG_E077_AGENT_EXISTS, got {msg}"
    );

    assert!(contract.vaults.get(&0).unwrap().agents.contains(&agent_id));
    assert_eq!(contract.agent_to_vault.get(&agent_id), Some(&0));
    assert!(
        !has_create_account_for(&agent_id),
        "E077 must fire before create_account"
    );
}

#[test]
fn test_add_agent_duplicate_panics_e077_before_promise() {
    let caller = accounts(1);
    let (mut context, mut contract) = init_contract(caller.clone());
    let owner = create_and_activate_vault(&mut contract, &mut context);

    enter_callback_context(&mut context);
    let agent_id = register_live_agent(&mut contract, 0, "agent1");

    context.predecessor_account_id(caller);
    context.attached_deposit(NearToken::from_yoctonear(
        MIN_AGENT_FUNDING + AGENT_STORAGE_OVERHEAD,
    ));
    context.prepaid_gas(Gas::from_tgas(50));
    testing_env!(context.build());

    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.execute_owner_action(owner, add_agent_action(0, "agent1"));
    }));
    let payload = panicked.expect_err("duplicate AddAgent must panic");
    let msg = panic_message(&payload);
    assert!(
        msg.contains("SG_E077_AGENT_EXISTS"),
        "expected SG_E077_AGENT_EXISTS, got {msg}"
    );
    assert!(
        !has_create_account_for(&agent_id),
        "duplicate AddAgent must not create a promise"
    );
}

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        format!("{payload:?}")
    }
}

fn has_create_account_for(agent_id: &AccountId) -> bool {
    get_created_receipts().iter().any(|receipt| {
        &receipt.receiver_id == agent_id
            && receipt
                .actions
                .iter()
                .any(|action| matches!(action, MockAction::CreateAccount { .. }))
    })
}

#[test]
fn test_vault_verification_refunds_when_vault_missing() {
    let caller = accounts(1);
    let (mut context, mut contract) = init_contract(caller.clone());
    enter_callback_context(&mut context);
    contract.on_vault_verified(
        99,
        caller.clone(),
        NearToken::from_yoctonear(VAULT_STORAGE_COST),
        Ok(bs58::encode(&[9u8; 32]).into_string()),
    );
    assert_eq!(
        transfer_amounts_to(&caller),
        vec![VAULT_STORAGE_COST],
        "vault-not-found must still refund the original caller"
    );
}

#[test]
fn test_vault_verification_bad_base58_refunds() {
    let caller = accounts(1);
    let (mut context, mut contract) = init_contract(caller.clone());
    create_and_activate_vault(&mut contract, &mut context);
    // Recreate as pending so verification can fail
    if let Some(vault) = contract.vaults.get_mut(&0) {
        vault.state = types::VaultState::PendingVerification;
    }

    enter_callback_context(&mut context);
    contract.on_vault_verified(
        0,
        caller.clone(),
        NearToken::from_yoctonear(VAULT_STORAGE_COST),
        Ok("%%%not-base58%%%".to_string()),
    );

    assert!(contract.vaults.get(&0).is_none());
    assert_eq!(
        transfer_amounts_to(&caller),
        vec![VAULT_STORAGE_COST],
        "undecodable MPC key must be treated as a mismatch and refunded"
    );
}

#[test]
fn test_owner_action_refund_never_exceeds_attached() {
    let caller = accounts(1);
    let (mut context, mut contract) = init_contract(caller.clone());
    create_and_activate_vault(&mut contract, &mut context);

    let gas_funding = MIN_AGENT_FUNDING;
    let required = gas_funding + AGENT_STORAGE_OVERHEAD;
    let excess = NearToken::from_near(5).as_yoctonear();
    let attached = required + excess;

    context.predecessor_account_id(caller.clone());
    context.attached_deposit(NearToken::from_yoctonear(attached));
    testing_env!(context.build());

    let msg = add_agent_message(1, gas_funding);
    let sig = sign_admin(&msg);
    contract.owner_action(msg, sig);

    let refunded_to_caller: u128 = transfer_amounts_to(&caller).iter().sum();
    assert_eq!(refunded_to_caller, excess);
    assert!(refunded_to_caller < attached);

    // Failure callback refunds only the remaining required deposit.
    enter_callback_context(&mut context);
    contract.on_agent_created(
        0,
        "agent1".to_string(),
        caller.clone(),
        NearToken::from_yoctonear(required),
        Err(near_sdk::PromiseError::Failed),
    );
    let failure_refund: u128 = transfer_amounts_to(&caller).iter().sum();
    assert_eq!(failure_refund, required);
    assert_eq!(
        refunded_to_caller + failure_refund,
        attached,
        "excess refund plus failure refund must equal attached, never more"
    );
}
