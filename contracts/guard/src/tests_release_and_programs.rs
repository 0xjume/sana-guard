// Program allowlist enforcement and reservation release accounting
use crate::owner::OwnerAction;
use crate::parser::{MEMO_V2_PROGRAM, SYSTEM_PROGRAM};
use crate::types::*;
use crate::*;
use near_sdk::json_types::U64;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, Gas, PromiseError};

const NOW: u64 = 1_000_000_000_000_000_000;
const HOUR_NS: u64 = 3_600_000_000_000;
const OWNER: [u8; 32] = [9u8; 32];
const VAULT_ADDRESS: [u8; 32] = [1u8; 32];
const RECIPIENT: [u8; 32] = [2u8; 32];

fn set_context(timestamp_ns: u64) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(accounts(0))
        .predecessor_account_id(accounts(1))
        .block_timestamp(timestamp_ns)
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(builder.build());
}

fn policy(programs: Vec<[u8; 32]>) -> Policy {
    Policy {
        per_tx_limit: vec![(Mint::Sol, U64(1_000_000_000))],
        daily_cap: vec![(Mint::Sol, U64(10_000_000_000))],
        programs: programs.iter().map(|p| base58_encode(p)).collect(),
        max_priority_fee_lamports: U64(1_000_000),
        max_memo_len: 100,
        expires_at_ns: U64(u64::MAX),
        loosen_delay_ns: U64(HOUR_NS),
    }
}

/// Contract with vault 0 whose agent is accounts(1) and which may pay RECIPIENT.
fn setup(programs: Vec<[u8; 32]>) -> Guard {
    set_context(NOW);
    let mut contract = Guard::new(
        "v1.signer-prod.testnet".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        accounts(0),
    );
    let mut vault = Vault::new(
        0,
        OWNER,
        VAULT_ADDRESS,
        "vault/test/0".to_string(),
        policy(programs),
    );
    vault.agents.push(accounts(1));
    vault.recipients.insert(RECIPIENT);
    contract.vaults.insert(0, vault);
    contract.agent_to_vault.insert(accounts(1), 0);
    contract
}

/// Legacy message: SystemProgram transfer of `lamports` from the vault to RECIPIENT,
/// optionally followed by a memo. `blockhash_byte` varies the message hash.
fn transfer_message(lamports: u64, memo: Option<&[u8]>, blockhash_byte: u8) -> String {
    let mut msg = vec![1, 0, if memo.is_some() { 2 } else { 1 }];
    msg.push(if memo.is_some() { 4 } else { 3 });
    msg.extend_from_slice(&VAULT_ADDRESS);
    msg.extend_from_slice(&RECIPIENT);
    msg.extend_from_slice(&SYSTEM_PROGRAM);
    if memo.is_some() {
        msg.extend_from_slice(&MEMO_V2_PROGRAM);
    }
    msg.extend_from_slice(&[blockhash_byte; 32]);
    msg.push(if memo.is_some() { 2 } else { 1 });
    msg.extend_from_slice(&[2, 2, 0, 1, 12]);
    msg.extend_from_slice(&2u32.to_le_bytes());
    msg.extend_from_slice(&lamports.to_le_bytes());
    if let Some(text) = memo {
        msg.extend_from_slice(&[3, 0, text.len() as u8]);
        msg.extend_from_slice(text);
    }
    use near_sdk::base64::engine::general_purpose::STANDARD;
    use near_sdk::base64::Engine;
    STANDARD.encode(msg)
}

fn sol_spent(contract: &Guard) -> u64 {
    contract
        .get_spend_24h(0)
        .into_iter()
        .find(|(m, _)| m == "SOL")
        .map(|(_, a)| a)
        .unwrap_or(0)
}

fn sign(contract: &mut Guard, lamports: u64, blockhash_byte: u8) -> [u8; 32] {
    let req_id = [blockhash_byte; 32];
    let _ = contract.request_sign(
        0,
        transfer_message(lamports, None, blockhash_byte),
        hex::encode(req_id),
    );
    req_id
}

fn status(contract: &Guard, req_id: [u8; 32]) -> Status {
    contract.requests.get(&req_id).unwrap().status.clone()
}

fn release(contract: &mut Guard, req_id: [u8; 32]) -> String {
    contract.execute_owner_action(
        OWNER,
        OwnerAction::Release {
            vault_id: 0,
            req_id: hex::encode(req_id),
        },
    )
}

// Program allowlist

#[test]
fn test_allowed_program_signs() {
    let mut contract = setup(vec![SYSTEM_PROGRAM]);
    let req_id = sign(&mut contract, 100_000_000, 7);
    assert!(matches!(status(&contract, req_id), Status::Pending));
    assert_eq!(sol_spent(&contract), 100_000_000);
}

#[test]
#[should_panic(expected = "SG_E074_PROGRAM_NOT_ALLOWED")]
fn test_empty_program_allowlist_rejects_everything() {
    let mut contract = setup(vec![]);
    sign(&mut contract, 100_000_000, 7);
}

#[test]
#[should_panic(expected = "SG_E074_PROGRAM_NOT_ALLOWED")]
fn test_program_not_in_allowlist_rejected() {
    let mut contract = setup(vec![SYSTEM_PROGRAM]);
    let _ = contract.request_sign(
        0,
        transfer_message(100_000_000, Some(b"hi"), 7),
        hex::encode([7u8; 32]),
    );
}

#[test]
fn test_all_listed_programs_sign() {
    let mut contract = setup(vec![SYSTEM_PROGRAM, MEMO_V2_PROGRAM]);
    let _ = contract.request_sign(
        0,
        transfer_message(100_000_000, Some(b"hi"), 7),
        hex::encode([7u8; 32]),
    );
    assert_eq!(sol_spent(&contract), 100_000_000);
}

#[test]
#[should_panic(expected = "SG_E075_INVALID_POLICY_PROGRAM")]
fn test_create_vault_rejects_unsupported_program() {
    let mut contract = setup(vec![]);
    let mut p = policy(vec![]);
    p.programs = vec![base58_encode(&[42u8; 32])];
    contract.execute_owner_action(
        OWNER,
        OwnerAction::CreateVault {
            owner: base58_encode(&OWNER),
            vault_address: base58_encode(&[3u8; 32]),
            policy: p,
        },
    );
}

#[test]
#[should_panic(expected = "SG_E075_INVALID_POLICY_PROGRAM")]
fn test_set_policy_rejects_malformed_program() {
    let mut contract = setup(vec![SYSTEM_PROGRAM]);
    let mut p = policy(vec![SYSTEM_PROGRAM]);
    p.programs.push("not-base58!".to_string());
    contract.execute_owner_action(
        OWNER,
        OwnerAction::SetPolicy {
            vault_id: 0,
            policy: p,
        },
    );
}

#[test]
fn test_adding_program_is_a_delayed_loosen() {
    let mut contract = setup(vec![SYSTEM_PROGRAM]);
    contract.execute_owner_action(
        OWNER,
        OwnerAction::SetPolicy {
            vault_id: 0,
            policy: policy(vec![SYSTEM_PROGRAM, MEMO_V2_PROGRAM]),
        },
    );
    let vault = contract.vaults.get(&0).unwrap();
    assert_eq!(vault.policy.programs.len(), 1);
    assert!(vault.pending_loosen.is_some());
}

#[test]
fn test_removing_program_applies_immediately() {
    let mut contract = setup(vec![SYSTEM_PROGRAM, MEMO_V2_PROGRAM]);
    contract.execute_owner_action(
        OWNER,
        OwnerAction::SetPolicy {
            vault_id: 0,
            policy: policy(vec![SYSTEM_PROGRAM]),
        },
    );
    let vault = contract.vaults.get(&0).unwrap();
    assert_eq!(vault.policy.programs, vec![base58_encode(&SYSTEM_PROGRAM)]);
    assert!(vault.pending_loosen.is_none());
}

// Reservation release accounting

#[test]
fn test_mpc_error_releases_once_and_owner_release_is_refused() {
    let mut contract = setup(vec![SYSTEM_PROGRAM]);
    let failed = sign(&mut contract, 300_000_000, 1);
    sign(&mut contract, 200_000_000, 2);
    assert_eq!(sol_spent(&contract), 500_000_000);

    contract.on_signed(failed, Err(PromiseError::Failed));
    assert!(matches!(status(&contract, failed), Status::Failed));
    assert_eq!(sol_spent(&contract), 200_000_000);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        release(&mut contract, failed);
    }));
    assert!(result.is_err());
    // The other request's reservation is untouched
    assert_eq!(sol_spent(&contract), 200_000_000);
}

#[test]
fn test_malformed_signature_releases_reservation() {
    let mut contract = setup(vec![SYSTEM_PROGRAM]);
    let req_id = sign(&mut contract, 300_000_000, 1);

    let sig = contract.on_signed(
        req_id,
        Ok(MpcSignature::Ed25519 {
            signature: vec![9u8; 32],
        }),
    );
    assert!(sig.is_none());
    assert!(matches!(status(&contract, req_id), Status::Failed));
    assert_eq!(sol_spent(&contract), 0);
}

#[test]
fn test_mpc_error_after_owner_release_does_not_release_twice() {
    let mut contract = setup(vec![SYSTEM_PROGRAM]);
    let stuck = sign(&mut contract, 300_000_000, 1);
    sign(&mut contract, 200_000_000, 2);

    set_context(NOW + 3 * 60 * 1_000_000_000);
    release(&mut contract, stuck);
    assert_eq!(sol_spent(&contract), 200_000_000);

    contract.on_signed(stuck, Err(PromiseError::Failed));
    assert!(matches!(status(&contract, stuck), Status::Released));
    assert_eq!(sol_spent(&contract), 200_000_000);
}

#[test]
fn test_signature_after_owner_release_is_reserved_again() {
    let mut contract = setup(vec![SYSTEM_PROGRAM]);
    let stuck = sign(&mut contract, 300_000_000, 1);

    set_context(NOW + 3 * 60 * 1_000_000_000);
    release(&mut contract, stuck);
    assert_eq!(sol_spent(&contract), 0);

    let sig = contract.on_signed(
        stuck,
        Ok(MpcSignature::Ed25519 {
            signature: vec![9u8; 64],
        }),
    );
    assert_eq!(sig.unwrap().len(), 64);
    assert!(matches!(status(&contract, stuck), Status::Signed));
    assert_eq!(sol_spent(&contract), 300_000_000);
}

#[test]
fn test_duplicate_callback_is_ignored() {
    let mut contract = setup(vec![SYSTEM_PROGRAM]);
    let req_id = sign(&mut contract, 300_000_000, 1);

    contract.on_signed(req_id, Err(PromiseError::Failed));
    contract.on_signed(req_id, Err(PromiseError::Failed));
    assert_eq!(sol_spent(&contract), 0);

    let sig = contract.on_signed(
        req_id,
        Ok(MpcSignature::Ed25519 {
            signature: vec![9u8; 64],
        }),
    );
    assert!(sig.is_none());
    assert!(matches!(status(&contract, req_id), Status::Failed));
}
