//! near-workspaces end to end: agent `request_sign` -> mock MPC `sign` -> `on_signed`.
//!
//! Covers what the unit tests cannot: real cross-contract promises, the function-call key the
//! contract gives an agent, the 1 yocto the guard attaches for MPC, reservation release when MPC
//! fails, and the gas a sign request actually burns (PLAN spike S3).
mod common;

use common::{admin_message, guard_and_mock_wasm, json_u64, sign, NETWORK, VAULT_B58};
use ed25519_dalek::SigningKey;
use near_sdk::base64::engine::general_purpose::STANDARD;
use near_sdk::base64::Engine;
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract, Worker};
use serde_json::json;

const SYSTEM_PROGRAM: [u8; 32] = [0u8; 32];
const COMPUTE_BUDGET_B58: &str = "ComputeBudget111111111111111111111111111111";
const VAULT_ADDRESS: [u8; 32] = [1u8; 32];
const RECIPIENT: [u8; 32] = [2u8; 32];
const MAX_TX_GAS_TGAS: u64 = 300;

/// Legacy Solana message: `transfers` SystemProgram transfers of `lamports` each from the vault
/// to RECIPIENT. `blockhash_byte` makes each message (and its hash) unique.
fn transfer_message(transfers: u8, lamports: u64, blockhash_byte: u8) -> String {
    let mut msg = vec![1, 0, 1, 3];
    msg.extend_from_slice(&VAULT_ADDRESS);
    msg.extend_from_slice(&RECIPIENT);
    msg.extend_from_slice(&SYSTEM_PROGRAM);
    msg.extend_from_slice(&[blockhash_byte; 32]);
    msg.push(transfers);
    for _ in 0..transfers {
        msg.extend_from_slice(&[2, 2, 0, 1, 12]);
        msg.extend_from_slice(&2u32.to_le_bytes());
        msg.extend_from_slice(&lamports.to_le_bytes());
    }
    STANDARD.encode(msg)
}

struct Env {
    worker: Worker<Sandbox>,
    guard: Contract,
    mpc: Contract,
    agent: Account,
    vault_id: u32,
}

async fn owner_action(
    guard: &Contract,
    key: &SigningKey,
    vault: Option<u32>,
    nonce: u64,
    action: serde_json::Value,
    deposit: NearToken,
) -> Result<(), Box<dyn std::error::Error>> {
    let msg = admin_message(guard.id().as_ref(), vault, nonce, action);
    guard
        .call("owner_action")
        .args_json(json!({ "msg": msg, "sig": sign(key, &msg) }))
        .deposit(deposit)
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// Guard + mock MPC, one active vault with a SOL policy, RECIPIENT allowlisted, and an agent
/// subaccount created through AddAgent whose function-call key we hold.
async fn setup() -> Result<Env, Box<dyn std::error::Error>> {
    let (guard_wasm, mock_wasm) = guard_and_mock_wasm();
    let worker = near_workspaces::sandbox().await?;
    let mpc = worker.dev_deploy(&mock_wasm).await?;
    mpc.call("new").max_gas().transact().await?.into_result()?;
    let guard = worker.dev_deploy(&guard_wasm).await?;
    guard
        .call("new")
        .args_json(json!({
            "mpc_contract": mpc.id(),
            "mpc_domain_id": 1,
            "network_tag": NETWORK,
            "admin": guard.id(),
        }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let key = SigningKey::from_bytes(&[7u8; 32]);
    let owner_b58 = bs58::encode(key.verifying_key().as_bytes()).into_string();
    owner_action(
        &guard,
        &key,
        None,
        1,
        json!({
            "type": "CreateVault",
            "owner": owner_b58,
            "vault_address": VAULT_B58,
            "policy": {
                "per_tx_limit": [["Sol", "1000000000"]],
                "daily_cap": [["Sol", "10000000000"]],
                "programs": [bs58::encode(SYSTEM_PROGRAM).into_string(), COMPUTE_BUDGET_B58],
                "max_priority_fee_lamports": "1",
                "max_total_priority_fee_lamports": "1000000",
                "max_memo_len": 64,
                "expires_at_ns": "18446744073709551615",
                "loosen_delay_ns": "3600000000000",
            },
        }),
        NearToken::from_near(1),
    )
    .await?;
    let vault_id = 0;

    owner_action(
        &guard,
        &key,
        Some(vault_id),
        2,
        json!({
            "type": "AddRecipient",
            "vault_id": vault_id,
            "recipient": bs58::encode(RECIPIENT).into_string(),
        }),
        NearToken::from_yoctonear(0),
    )
    .await?;

    let agent_key = SecretKey::from_random(KeyType::ED25519);
    owner_action(
        &guard,
        &key,
        Some(vault_id),
        3,
        json!({
            "type": "AddAgent",
            "vault_id": vault_id,
            "name": "bot",
            "public_key": agent_key.public_key().to_string(),
            "gas_funding": NearToken::from_millinear(200).as_yoctonear().to_string(),
        }),
        // gas_funding + AGENT_STORAGE_OVERHEAD (0.05 NEAR)
        NearToken::from_millinear(250),
    )
    .await?;

    let agent_id = format!("bot.{}", guard.id()).parse()?;
    let vault: serde_json::Value = guard
        .view("get_vault")
        .args_json(json!({ "vault_id": vault_id }))
        .await?
        .json()?;
    assert_eq!(vault["state"], "Active");
    assert_eq!(
        vault["agents"],
        json!([agent_id]),
        "AddAgent did not register the agent"
    );

    let agent = Account::from_secret_key(agent_id, agent_key, &worker);
    Ok(Env {
        worker,
        guard,
        mpc,
        agent,
        vault_id,
    })
}

async fn sol_spent(env: &Env) -> Result<u64, Box<dyn std::error::Error>> {
    let spend: Vec<(String, serde_json::Value)> = env
        .guard
        .view("get_spend_24h")
        .args_json(json!({ "vault_id": env.vault_id }))
        .await?
        .json()?;
    Ok(spend
        .iter()
        .find(|(mint, _)| mint == "SOL")
        .map(|(_, amount)| json_u64(amount))
        .unwrap_or(0))
}

async fn request_status(env: &Env, req_id: &str) -> Result<String, Box<dyn std::error::Error>> {
    let request: serde_json::Value = env
        .guard
        .view("get_request")
        .args_json(json!({ "req_id_hex": req_id }))
        .await?
        .json()?;
    Ok(request["status"]["status"]
        .as_str()
        .unwrap_or_default()
        .to_string())
}

/// Sends request_sign as the agent; returns (callback result, total Tgas burnt).
async fn request_sign(
    env: &Env,
    message_b64: String,
    req_id: &str,
) -> Result<(Option<Vec<u8>>, u64), Box<dyn std::error::Error>> {
    let outcome = env
        .agent
        .call(env.guard.id(), "request_sign")
        .args_json(json!({
            "vault_id": env.vault_id,
            "message_b64": message_b64,
            "req_id_hex": req_id,
        }))
        .gas(Gas::from_tgas(MAX_TX_GAS_TGAS))
        .transact()
        .await?;
    let tgas = outcome.total_gas_burnt.as_tgas();
    let result: Option<Vec<u8>> = outcome.into_result()?.json()?;
    Ok((result, tgas))
}

#[tokio::test]
async fn agent_request_sign_end_to_end() -> Result<(), Box<dyn std::error::Error>> {
    let env = setup().await?;

    // 1 transfer: MPC signs, the request is recorded as Signed and the spend is reserved.
    let req_one = "11".repeat(32);
    let (signature, gas_one) =
        request_sign(&env, transfer_message(1, 1_000_000, 1), &req_one).await?;
    assert_eq!(signature.map(|s| s.len()), Some(64));
    assert_eq!(request_status(&env, &req_one).await?, "Signed");
    assert_eq!(sol_spent(&env).await?, 1_000_000);

    // 8 transfers (the parser's instruction maximum): the worst case for parse + policy gas.
    let req_eight = "22".repeat(32);
    let (signature, gas_eight) =
        request_sign(&env, transfer_message(8, 1_000_000, 2), &req_eight).await?;
    assert_eq!(signature.map(|s| s.len()), Some(64));
    assert_eq!(sol_spent(&env).await?, 9_000_000);

    let mpc_calls: u32 = env.mpc.view("sign_calls").await?.json()?;
    assert_eq!(mpc_calls, 2);

    println!("request_sign gas: 1 instruction = {gas_one} Tgas, 8 instructions = {gas_eight} Tgas");
    assert!(gas_one < MAX_TX_GAS_TGAS && gas_eight < MAX_TX_GAS_TGAS);
    Ok(())
}

#[tokio::test]
async fn mpc_failure_releases_the_reservation() -> Result<(), Box<dyn std::error::Error>> {
    let env = setup().await?;
    env.mpc
        .call("set_fail_sign")
        .args_json(json!({ "fail": true }))
        .transact()
        .await?
        .into_result()?;

    let req = "33".repeat(32);
    let (signature, _) = request_sign(&env, transfer_message(1, 5_000_000, 3), &req).await?;
    assert_eq!(
        signature, None,
        "a failed MPC call must not return a signature"
    );
    assert_eq!(request_status(&env, &req).await?, "Failed");
    assert_eq!(
        sol_spent(&env).await?,
        0,
        "failed request must release its spend"
    );
    Ok(())
}

#[tokio::test]
async fn policy_violation_is_rejected_before_mpc() -> Result<(), Box<dyn std::error::Error>> {
    let env = setup().await?;

    // 2 SOL is over the 1 SOL per-tx limit.
    let over = env
        .agent
        .call(env.guard.id(), "request_sign")
        .args_json(json!({
            "vault_id": env.vault_id,
            "message_b64": transfer_message(1, 2_000_000_000, 4),
            "req_id_hex": "44".repeat(32),
        }))
        .gas(Gas::from_tgas(MAX_TX_GAS_TGAS))
        .transact()
        .await?;
    assert!(over.is_failure());
    assert!(format!("{:?}", over.into_result().unwrap_err()).contains("SG_E062"));

    // Any other account is not a registered agent.
    let stranger = env.worker.dev_create_account().await?;
    let not_agent = stranger
        .call(env.guard.id(), "request_sign")
        .args_json(json!({
            "vault_id": env.vault_id,
            "message_b64": transfer_message(1, 1_000, 5),
            "req_id_hex": "55".repeat(32),
        }))
        .gas(Gas::from_tgas(MAX_TX_GAS_TGAS))
        .transact()
        .await?;
    assert!(format!("{:?}", not_agent.into_result().unwrap_err()).contains("SG_E052"));

    let mpc_calls: u32 = env.mpc.view("sign_calls").await?.json()?;
    assert_eq!(mpc_calls, 0, "rejected requests must never reach MPC");
    assert_eq!(sol_spent(&env).await?, 0);
    Ok(())
}
