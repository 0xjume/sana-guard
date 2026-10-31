// SetPolicy loosen-vs-tighten for max_total_priority_fee_lamports and loosen_delay_ns.
// Tightening applies immediately; loosening is stored in pending_loosen until the delay elapses.
use crate::owner::OwnerAction;
use crate::types::*;
use crate::*;
use near_sdk::json_types::U64;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, Gas};

const NOW: u64 = 1_000_000_000_000_000_000;
const HOUR_NS: u64 = 3_600_000_000_000;
const OWNER: [u8; 32] = [9u8; 32];
const VAULT_ADDRESS: [u8; 32] = [1u8; 32];
const CAP: u64 = 1_000_000;

fn set_context(timestamp_ns: u64) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(accounts(0))
        .predecessor_account_id(accounts(1))
        .block_timestamp(timestamp_ns)
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(builder.build());
}

fn policy(cap: Option<u64>, delay_ns: u64) -> Policy {
    Policy {
        per_tx_limit: vec![],
        daily_cap: vec![],
        programs: vec![],
        max_priority_fee_lamports: U64(1_000_000),
        max_total_priority_fee_lamports: cap.map(U64),
        max_memo_len: 100,
        expires_at_ns: U64(u64::MAX),
        loosen_delay_ns: U64(delay_ns),
    }
}

fn setup(cap: Option<u64>) -> Guard {
    set_context(NOW);
    let mut contract = Guard::new(
        "v1.signer-prod.testnet".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        accounts(0),
    );
    let vault = Vault::new(
        0,
        OWNER,
        VAULT_ADDRESS,
        "vault/test/0".to_string(),
        policy(cap, HOUR_NS),
    );
    contract.vaults.insert(0, vault);
    contract
}

fn set_policy(contract: &mut Guard, next: Policy) -> String {
    contract.execute_owner_action(
        OWNER,
        OwnerAction::SetPolicy {
            vault_id: 0,
            policy: next,
        },
    )
}

fn active_cap(contract: &Guard) -> Option<u64> {
    contract
        .vaults
        .get(&0)
        .unwrap()
        .policy
        .max_total_priority_fee_lamports
        .map(|c| c.0)
}

fn pending(contract: &Guard) -> Option<(Option<u64>, u64)> {
    contract
        .vaults
        .get(&0)
        .unwrap()
        .pending_loosen
        .as_ref()
        .map(|(p, ns)| (p.max_total_priority_fee_lamports.map(|c| c.0), *ns))
}

#[test]
fn removing_total_priority_fee_cap_is_pending_with_delay() {
    let mut contract = setup(Some(CAP));
    let result = set_policy(&mut contract, policy(None, HOUR_NS));
    assert!(
        result.contains("scheduled") || result.contains("loosen"),
        "removing the cap must be a delayed loosen, got {result}"
    );
    assert_eq!(active_cap(&contract), Some(CAP));
    assert_eq!(pending(&contract), Some((None, NOW + HOUR_NS)));

    set_context(NOW + HOUR_NS);
    contract.apply_pending_policy(0);
    assert_eq!(active_cap(&contract), None);
    assert_eq!(pending(&contract), None);
}

#[test]
#[should_panic(expected = "delay not elapsed")]
fn pending_total_fee_cap_cannot_apply_before_delay() {
    let mut contract = setup(Some(CAP));
    set_policy(&mut contract, policy(None, HOUR_NS));
    set_context(NOW + HOUR_NS - 1);
    contract.apply_pending_policy(0);
}

#[test]
fn raising_total_priority_fee_cap_is_pending() {
    let mut contract = setup(Some(CAP));
    let result = set_policy(&mut contract, policy(Some(CAP * 2), HOUR_NS));
    assert!(
        result.contains("scheduled") || result.contains("loosen"),
        "raising the cap must be a delayed loosen, got {result}"
    );
    assert_eq!(active_cap(&contract), Some(CAP));
    assert_eq!(pending(&contract), Some((Some(CAP * 2), NOW + HOUR_NS)));
}

#[test]
fn lowering_total_priority_fee_cap_is_immediate() {
    let mut contract = setup(Some(CAP));
    let result = set_policy(&mut contract, policy(Some(CAP / 2), HOUR_NS));
    assert!(
        result.contains("immediately"),
        "lowering the cap must apply now, got {result}"
    );
    assert_eq!(active_cap(&contract), Some(CAP / 2));
    assert_eq!(pending(&contract), None);
}

#[test]
fn setting_total_priority_fee_cap_is_immediate() {
    let mut contract = setup(None);
    let result = set_policy(&mut contract, policy(Some(CAP), HOUR_NS));
    assert!(
        result.contains("immediately"),
        "None -> Some is tightening and must apply now, got {result}"
    );
    assert_eq!(active_cap(&contract), Some(CAP));
    assert_eq!(pending(&contract), None);
}

#[test]
fn unchanged_total_priority_fee_cap_is_immediate() {
    let mut contract = setup(Some(CAP));
    let result = set_policy(&mut contract, policy(Some(CAP), HOUR_NS));
    assert!(
        result.contains("immediately"),
        "an identical cap is not a loosen, got {result}"
    );
    assert_eq!(active_cap(&contract), Some(CAP));
    assert_eq!(pending(&contract), None);
}

#[test]
fn decreasing_loosen_delay_is_pending() {
    let mut contract = setup(Some(CAP));
    let result = set_policy(&mut contract, policy(Some(CAP), HOUR_NS / 2));
    assert!(
        result.contains("scheduled") || result.contains("loosen"),
        "a shorter loosen delay is itself a loosen, got {result}"
    );
    let vault = contract.vaults.get(&0).unwrap();
    assert_eq!(vault.policy.loosen_delay_ns.0, HOUR_NS);
    let (pending_policy, effective_ns) = vault.pending_loosen.as_ref().expect("pending loosen");
    assert_eq!(pending_policy.loosen_delay_ns.0, HOUR_NS / 2);
    assert_eq!(*effective_ns, NOW + HOUR_NS);
}

#[test]
fn increasing_loosen_delay_is_immediate() {
    let mut contract = setup(Some(CAP));
    let result = set_policy(&mut contract, policy(Some(CAP), HOUR_NS * 2));
    assert!(
        result.contains("immediately"),
        "a longer loosen delay is tightening, got {result}"
    );
    let vault = contract.vaults.get(&0).unwrap();
    assert_eq!(vault.policy.loosen_delay_ns.0, HOUR_NS * 2);
    assert!(vault.pending_loosen.is_none());
}
