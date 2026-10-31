// Priority fee accounting: a SetComputeUnitPrice without SetComputeUnitLimit still pays
// price x the runtime's default limit, and max_total_priority_fee_lamports caps the total.
use crate::parser::{
    calculate_spend, priority_fee_lamports, ParsedInstruction, COMPUTE_BUDGET_PROGRAM,
    SYSTEM_PROGRAM,
};
use crate::types::*;
use crate::*;
use near_sdk::json_types::U64;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, Gas};

const VAULT_ADDRESS: [u8; 32] = [1u8; 32];
const RECIPIENT: [u8; 32] = [2u8; 32];

fn transfer(lamports: u64) -> ParsedInstruction {
    ParsedInstruction::SystemTransfer {
        from: VAULT_ADDRESS,
        to: RECIPIENT,
        lamports,
    }
}

fn sol_spend(instructions: &[ParsedInstruction]) -> u64 {
    calculate_spend(instructions, &VAULT_ADDRESS)
        .unwrap()
        .into_iter()
        .find(|(m, _)| *m == Mint::Sol)
        .map(|(_, a)| a)
        .unwrap_or(0)
}

#[test]
fn test_price_without_limit_uses_default_limit() {
    // 2 instructions -> default 400_000 CU; 1_000_000 micro-lamports/CU -> 400_000 lamports
    let ixs = [
        ParsedInstruction::ComputeBudgetSetPrice {
            micro_lamports: 1_000_000,
        },
        transfer(1_000),
    ];
    assert_eq!(priority_fee_lamports(&ixs).unwrap(), 400_000);
    assert_eq!(sol_spend(&ixs), 1_000 + 400_000 + 5_000);
}

#[test]
fn test_default_limit_is_capped_at_runtime_max() {
    let mut ixs = vec![ParsedInstruction::ComputeBudgetSetPrice { micro_lamports: 1 }];
    ixs.extend((0..7).map(|_| transfer(1)));
    // 8 x 200_000 = 1_600_000 -> capped at 1_400_000 CU; rounds up to 2 lamports
    assert_eq!(priority_fee_lamports(&ixs).unwrap(), 2);
}

#[test]
fn test_explicit_limit_is_used() {
    let ixs = [
        ParsedInstruction::ComputeBudgetSetLimit { limit: 10_000 },
        ParsedInstruction::ComputeBudgetSetPrice {
            micro_lamports: 1_000_000,
        },
        transfer(1_000),
    ];
    assert_eq!(priority_fee_lamports(&ixs).unwrap(), 10_000);
    assert_eq!(sol_spend(&ixs), 1_000 + 10_000 + 5_000);
}

#[test]
fn test_limit_without_price_costs_nothing() {
    let ixs = [
        ParsedInstruction::ComputeBudgetSetLimit { limit: 1_400_000 },
        transfer(1_000),
    ];
    assert_eq!(priority_fee_lamports(&ixs).unwrap(), 0);
    assert_eq!(sol_spend(&ixs), 1_000);
}

#[test]
fn test_price_overflow_is_rejected() {
    let ixs = [
        ParsedInstruction::ComputeBudgetSetPrice {
            micro_lamports: u64::MAX,
        },
        transfer(1),
    ];
    assert_eq!(priority_fee_lamports(&ixs), Err("SG_E049_OVERFLOW"));
}

// request_sign end to end

fn setup(total_fee_cap: Option<u64>) -> Guard {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(accounts(0))
        .predecessor_account_id(accounts(1))
        .block_timestamp(1_000_000_000_000_000_000)
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(builder.build());

    let mut contract = Guard::new(
        "v1.signer-prod.testnet".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        accounts(0),
    );
    let mut vault = Vault::new(
        0,
        [9u8; 32],
        VAULT_ADDRESS,
        "vault/test/0".to_string(),
        Policy {
            per_tx_limit: vec![(Mint::Sol, U64(100_000_000_000))],
            daily_cap: vec![(Mint::Sol, U64(100_000_000_000))],
            programs: [SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM]
                .iter()
                .map(|p| base58_encode(p))
                .collect(),
            // Allows up to 10_000 lamports per CU (1e10 micro-lamports)
            max_priority_fee_lamports: U64(10_000),
            max_total_priority_fee_lamports: total_fee_cap.map(U64),
            max_memo_len: 0,
            expires_at_ns: U64(u64::MAX),
            loosen_delay_ns: U64(0),
        },
    );
    vault.agents.push(accounts(1));
    vault.recipients.insert(RECIPIENT);
    contract.vaults.insert(0, vault);
    contract.agent_to_vault.insert(accounts(1), 0);
    contract.activate_vault_for_test(0);
    contract
}

/// Legacy message: SetComputeUnitPrice(price), then a 1_000 lamport transfer to RECIPIENT.
fn price_only_message(micro_lamports: u64) -> String {
    let mut msg = vec![1, 0, 2, 4];
    msg.extend_from_slice(&VAULT_ADDRESS);
    msg.extend_from_slice(&RECIPIENT);
    msg.extend_from_slice(&SYSTEM_PROGRAM);
    msg.extend_from_slice(&COMPUTE_BUDGET_PROGRAM);
    msg.extend_from_slice(&[7u8; 32]); // blockhash
    msg.push(2);
    msg.extend_from_slice(&[3, 0, 9, 3]);
    msg.extend_from_slice(&micro_lamports.to_le_bytes());
    msg.extend_from_slice(&[2, 2, 0, 1, 12]);
    msg.extend_from_slice(&2u32.to_le_bytes());
    msg.extend_from_slice(&1_000u64.to_le_bytes());
    use near_sdk::base64::engine::general_purpose::STANDARD;
    use near_sdk::base64::Engine;
    STANDARD.encode(msg)
}

fn spent(contract: &Guard) -> u64 {
    contract
        .get_spend_24h(0)
        .into_iter()
        .find(|(m, _)| m == "SOL")
        .map(|(_, a)| a.0)
        .unwrap_or(0)
}

#[test]
fn test_price_only_fee_counts_toward_spend() {
    let mut contract = setup(None);
    // 1e10 micro-lamports/CU x 400_000 default CU = 4_000_000_000 lamports (4 SOL)
    let _ = contract.request_sign(0, price_only_message(10_000_000_000), "ab".repeat(32));
    assert_eq!(spent(&contract), 1_000 + 4_000_000_000 + 5_000);
}

#[test]
#[should_panic(expected = "SG_E078_PRIORITY_FEE_TOTAL_TOO_HIGH")]
fn test_total_priority_fee_cap_enforced() {
    let mut contract = setup(Some(100_000));
    let _ = contract.request_sign(0, price_only_message(10_000_000_000), "ab".repeat(32));
}

#[test]
fn test_total_priority_fee_within_cap_signs() {
    let mut contract = setup(Some(400_000));
    // 1_000_000 micro-lamports x 400_000 CU = 400_000 lamports, exactly at the cap
    let _ = contract.request_sign(0, price_only_message(1_000_000), "ab".repeat(32));
    assert_eq!(spent(&contract), 1_000 + 400_000 + 5_000);
}
