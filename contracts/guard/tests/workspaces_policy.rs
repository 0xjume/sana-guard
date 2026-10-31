//! near-workspaces: SetPolicy delay for `max_total_priority_fee_lamports`.
//!
//! Remove or raise the cap -> pending_loosen with the current delay.
//! Lower or set the cap -> apply immediately.
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::network::Sandbox;
use near_workspaces::types::NearToken;
use near_workspaces::{Contract, Worker};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;

const HOUR_NS: u64 = 3_600_000_000_000;
const CAP: u64 = 1_000_000;
const VAULT_B58: &str = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const NETWORK: &str = "near-testnet";

fn cargo_near_wasm(package_dir: &Path, artifact: &str) -> Vec<u8> {
    let status = Command::new("cargo")
        .args([
            "+stable",
            "near",
            "build",
            "non-reproducible-wasm",
            "--no-abi",
        ])
        .current_dir(package_dir)
        .status()
        .expect("spawn cargo near");
    assert!(
        status.success(),
        "cargo +stable near build failed in {}",
        package_dir.display()
    );
    let wasm = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/near")
        .join(artifact)
        .join(format!("{artifact}.wasm"));
    std::fs::read(&wasm).unwrap_or_else(|e| panic!("read {}: {e}", wasm.display()))
}

fn policy_json(cap: Option<u64>) -> serde_json::Value {
    json!({
        "per_tx_limit": [],
        "daily_cap": [],
        "programs": [],
        "max_priority_fee_lamports": "1000000",
        "max_total_priority_fee_lamports": cap.map(|c| c.to_string()),
        "max_memo_len": 100,
        "expires_at_ns": "18446744073709551615",
        "loosen_delay_ns": HOUR_NS.to_string(),
    })
}

fn admin_message(
    contract: &str,
    vault: Option<u32>,
    nonce: u64,
    action: serde_json::Value,
) -> String {
    let vault_line = vault.map_or_else(|| "null".to_string(), |v| v.to_string());
    format!(
        "SANA-GUARD-ADMIN-v1\nnetwork: {NETWORK}\ncontract: {contract}\nvault: {vault_line}\nnonce: {nonce}\nexpires: 18446744073709551615\naction: {}",
        action
    )
}

fn sign(key: &SigningKey, message: &str) -> Vec<u8> {
    key.sign(message.as_bytes()).to_bytes().to_vec()
}

fn json_u64(value: &serde_json::Value) -> u64 {
    match value {
        serde_json::Value::String(s) => s.parse().expect("u64 string"),
        serde_json::Value::Number(n) => n.as_u64().expect("u64 number"),
        other => panic!("expected u64, got {other}"),
    }
}

fn cap_of(policy: &serde_json::Value) -> Option<u64> {
    match &policy["max_total_priority_fee_lamports"] {
        serde_json::Value::Null => None,
        other => Some(json_u64(other)),
    }
}

struct Harness {
    worker: Worker<Sandbox>,
    contract: Contract,
    key: SigningKey,
    owner_b58: String,
    nonce: u64,
    next_vault_id: u32,
}

impl Harness {
    async fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let guard_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let mock_dir = guard_dir.join("../mock-mpc");
        let guard_wasm = cargo_near_wasm(&guard_dir, "sana_guard_contract");
        let mock_wasm = cargo_near_wasm(&mock_dir, "sana_guard_mock_mpc");

        let worker = near_workspaces::sandbox().await?;
        let mpc = worker.dev_deploy(&mock_wasm).await?;
        mpc.call("new").max_gas().transact().await?.into_result()?;

        let contract = worker.dev_deploy(&guard_wasm).await?;
        contract
            .call("new")
            .args_json(json!({
                "mpc_contract": mpc.id(),
                "mpc_domain_id": 1,
                "network_tag": NETWORK,
                "admin": contract.id(),
            }))
            .max_gas()
            .transact()
            .await?
            .into_result()?;

        let key = SigningKey::from_bytes(&[7u8; 32]);
        let owner_b58 = bs58::encode(key.verifying_key().as_bytes()).into_string();
        Ok(Self {
            worker,
            contract,
            key,
            owner_b58,
            nonce: 0,
            next_vault_id: 0,
        })
    }

    fn next_nonce(&mut self) -> u64 {
        self.nonce += 1;
        self.nonce
    }

    async fn create_vault(
        &mut self,
        initial_cap: Option<u64>,
    ) -> Result<u32, Box<dyn std::error::Error>> {
        let nonce = self.next_nonce();
        let vault_id = self.next_vault_id;
        self.next_vault_id += 1;
        let msg = admin_message(
            self.contract.id().as_ref(),
            None,
            nonce,
            json!({
                "type": "CreateVault",
                "owner": self.owner_b58,
                "vault_address": VAULT_B58,
                "policy": policy_json(initial_cap),
            }),
        );
        self.contract
            .call("owner_action")
            .args_json(json!({ "msg": msg, "sig": sign(&self.key, &msg) }))
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        let vault: serde_json::Value = self
            .contract
            .view("get_vault")
            .args_json(json!({ "vault_id": vault_id }))
            .await?
            .json()?;
        assert!(
            !vault.is_null(),
            "vault {vault_id} missing after CreateVault"
        );
        assert_eq!(vault["state"], "Active", "vault {vault_id} not verified");
        Ok(vault_id)
    }

    async fn set_policy(
        &mut self,
        vault_id: u32,
        cap: Option<u64>,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let nonce = self.next_nonce();
        let before = self.worker.view_block().await?.timestamp();
        let msg = admin_message(
            self.contract.id().as_ref(),
            Some(vault_id),
            nonce,
            json!({
                "type": "SetPolicy",
                "vault_id": vault_id,
                "policy": policy_json(cap),
            }),
        );
        self.contract
            .call("owner_action")
            .args_json(json!({ "msg": msg, "sig": sign(&self.key, &msg) }))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        let after = self.worker.view_block().await?.timestamp();
        let vault: serde_json::Value = self
            .contract
            .view("get_vault")
            .args_json(json!({ "vault_id": vault_id }))
            .await?
            .json()?;
        Ok(json!({
            "before": before,
            "after": after,
            "vault": vault,
        }))
    }
}

#[tokio::test]
async fn total_priority_fee_cap_set_policy_delay() -> Result<(), Box<dyn std::error::Error>> {
    let mut h = Harness::new().await?;

    // remove cap (Some -> None) -> pending with delay
    let remove_id = h.create_vault(Some(CAP)).await?;
    let remove = h.set_policy(remove_id, None).await?;
    let remove_vault = &remove["vault"];
    assert_eq!(cap_of(&remove_vault["policy"]), Some(CAP));
    assert!(
        !remove_vault["pending_loosen"].is_null(),
        "removing the cap must schedule pending_loosen: {remove}"
    );
    assert_eq!(cap_of(&remove_vault["pending_loosen"]["policy"]), None);
    let effective = json_u64(&remove_vault["pending_loosen"]["effective_ns"]);
    let before = json_u64(&remove["before"]);
    let after = json_u64(&remove["after"]);
    assert!(
        effective >= before + HOUR_NS && effective <= after + HOUR_NS,
        "remove-cap delay should be 1h from the SetPolicy block; effective={effective} before={before} after={after}"
    );

    // raise cap (Some -> higher Some) -> pending
    let raise_id = h.create_vault(Some(CAP)).await?;
    let raise = h.set_policy(raise_id, Some(CAP * 2)).await?;
    let raise_vault = &raise["vault"];
    assert_eq!(cap_of(&raise_vault["policy"]), Some(CAP));
    assert!(
        !raise_vault["pending_loosen"].is_null(),
        "raising the cap must schedule pending_loosen: {raise}"
    );
    assert_eq!(
        cap_of(&raise_vault["pending_loosen"]["policy"]),
        Some(CAP * 2)
    );

    // lower cap -> immediate
    let lower_id = h.create_vault(Some(CAP)).await?;
    let lower = h.set_policy(lower_id, Some(CAP / 2)).await?;
    let lower_vault = &lower["vault"];
    assert_eq!(cap_of(&lower_vault["policy"]), Some(CAP / 2));
    assert!(
        lower_vault["pending_loosen"].is_null(),
        "lowering the cap must apply immediately: {lower}"
    );

    // set cap (None -> Some) -> immediate
    let set_id = h.create_vault(None).await?;
    let set = h.set_policy(set_id, Some(CAP)).await?;
    let set_vault = &set["vault"];
    assert_eq!(cap_of(&set_vault["policy"]), Some(CAP));
    assert!(
        set_vault["pending_loosen"].is_null(),
        "setting the cap must apply immediately: {set}"
    );

    Ok(())
}
