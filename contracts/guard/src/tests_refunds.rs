// Deposit refunds: AddAgent excess, failed agent creation, vault verification
use crate::owner::VAULT_STORAGE_COST;
use crate::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::{U128, U64};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::testing_env;

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const FUNDING: u128 = ONE_NEAR / 5; // 0.2 NEAR
const OVERHEAD: u128 = ONE_NEAR / 20; // AGENT_STORAGE_OVERHEAD
const VAULT_ADDRESS: [u8; 32] = [9u8; 32];

fn guard_id() -> AccountId {
    "guard.testnet".parse().unwrap()
}

fn relay_id() -> AccountId {
    "relay.testnet".parse().unwrap()
}

fn set_context(predecessor: AccountId, deposit: u128) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(guard_id())
        .predecessor_account_id(predecessor)
        .block_timestamp(1_000_000_000_000_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit));
    testing_env!(builder.build());
}

fn owner_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

/// Contract with an active vault 0 owned by `owner_key()`.
fn setup() -> Guard {
    set_context(relay_id(), 0);
    let mut contract = Guard::new(
        "v1.signer-prod.testnet".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        "admin.testnet".parse().unwrap(),
    );
    let owner = owner_key().verifying_key().to_bytes();
    let vault = Vault::new(
        0,
        owner,
        VAULT_ADDRESS,
        "vault/test/0".to_string(),
        Policy {
            per_tx_limit: vec![],
            daily_cap: vec![],
            programs: vec![],
            max_priority_fee_lamports: U64(0),
            max_total_priority_fee_lamports: None,
            max_memo_len: 0,
            expires_at_ns: U64(u64::MAX),
            loosen_delay_ns: U64(0),
        },
    );
    contract.vaults.insert(0, vault);
    contract.activate_vault_for_test(0);
    contract
}

/// Total yocto transferred to `account` by receipts created so far.
fn transferred_to(account: &AccountId) -> u128 {
    get_created_receipts()
        .iter()
        .filter(|r| &r.receiver_id == account)
        .flat_map(|r| r.actions.iter())
        .map(|a| match a {
            MockAction::Transfer { deposit, .. } => deposit.as_yoctonear(),
            _ => 0,
        })
        .sum()
}

fn signed_add_agent() -> (String, Vec<u8>) {
    let msg = format!(
        "SANA-GUARD-ADMIN-v1\nnetwork: near-testnet\ncontract: {}\nvault: 0\nnonce: 1\nexpires: {}\naction: {{\"type\":\"AddAgent\",\"vault_id\":0,\"name\":\"bot\",\"public_key\":\"ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp\",\"gas_funding\":\"{}\"}}",
        guard_id(),
        u64::MAX,
        FUNDING
    );
    let sig = owner_key().sign(msg.as_bytes()).to_bytes().to_vec();
    (msg, sig)
}

#[test]
fn test_add_agent_excess_deposit_refunded_once() {
    let mut contract = setup();
    let excess = 3 * ONE_NEAR;
    set_context(relay_id(), FUNDING + OVERHEAD + excess);

    let (msg, sig) = signed_add_agent();
    contract.owner_action(msg, sig);

    assert_eq!(transferred_to(&relay_id()), excess);
}

#[test]
fn test_add_agent_exact_deposit_no_refund() {
    let mut contract = setup();
    set_context(relay_id(), FUNDING + OVERHEAD);

    let (msg, sig) = signed_add_agent();
    contract.owner_action(msg, sig);

    assert_eq!(transferred_to(&relay_id()), 0);
}

#[test]
fn test_failed_agent_creation_refunds_payer() {
    let mut contract = setup();
    set_context(guard_id(), 0);

    contract.on_agent_created(
        0,
        "bot".to_string(),
        relay_id(),
        U128(FUNDING + OVERHEAD),
        Err(PromiseError::Failed),
    );

    assert_eq!(transferred_to(&relay_id()), FUNDING + OVERHEAD);
    assert!(contract.get_vault(0).unwrap().agents.is_empty());
}

#[test]
fn test_successful_agent_creation_no_refund() {
    let mut contract = setup();
    set_context(guard_id(), 0);

    contract.on_agent_created(
        0,
        "bot".to_string(),
        relay_id(),
        U128(FUNDING + OVERHEAD),
        Ok(()),
    );

    assert_eq!(transferred_to(&relay_id()), 0);
    assert_eq!(contract.get_vault(0).unwrap().agents.len(), 1);
}

fn pending_vault() -> Guard {
    let mut contract = setup();
    contract.vaults.get_mut(&0).unwrap().state = VaultState::PendingVerification;
    set_context(guard_id(), 0);
    contract
}

#[test]
fn test_vault_verified_with_mpc_prefix() {
    let mut contract = pending_vault();
    let key = format!("ed25519:{}", bs58::encode(VAULT_ADDRESS).into_string());

    contract.on_vault_verified(0, relay_id(), Ok(key));

    assert_eq!(contract.get_vault(0).unwrap().state, VaultState::Active);
    assert_eq!(transferred_to(&relay_id()), 0);
}

#[test]
fn test_vault_mismatch_refunds_payer_not_self() {
    let mut contract = pending_vault();
    let key = format!("ed25519:{}", bs58::encode([10u8; 32]).into_string());

    contract.on_vault_verified(0, relay_id(), Ok(key));

    assert!(contract.get_vault(0).is_none());
    assert_eq!(transferred_to(&relay_id()), VAULT_STORAGE_COST);
    assert_eq!(transferred_to(&guard_id()), 0);
}

#[test]
fn test_vault_undecodable_key_refunds_without_panic() {
    let mut contract = pending_vault();

    contract.on_vault_verified(0, relay_id(), Ok("ed25519:not-base58!".to_string()));

    assert!(contract.get_vault(0).is_none());
    assert_eq!(transferred_to(&relay_id()), VAULT_STORAGE_COST);
}

#[test]
fn test_vault_mpc_error_refunds_payer() {
    let mut contract = pending_vault();

    contract.on_vault_verified(0, relay_id(), Err(PromiseError::Failed));

    assert!(contract.get_vault(0).is_none());
    assert_eq!(transferred_to(&relay_id()), VAULT_STORAGE_COST);
}
