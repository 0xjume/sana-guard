//! Helpers shared by the near-workspaces integration tests.
#![allow(dead_code)]

use ed25519_dalek::{Signer, SigningKey};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const VAULT_B58: &str = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
pub const NETWORK: &str = "near-testnet";

pub fn cargo_near_wasm(package_dir: &Path, artifact: &str) -> Vec<u8> {
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

pub fn guard_and_mock_wasm() -> (Vec<u8>, Vec<u8>) {
    let guard_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mock_dir = guard_dir.join("../mock-mpc");
    (
        cargo_near_wasm(&guard_dir, "sana_guard_contract"),
        cargo_near_wasm(&mock_dir, "sana_guard_mock_mpc"),
    )
}

pub fn admin_message(
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

pub fn sign(key: &SigningKey, message: &str) -> Vec<u8> {
    key.sign(message.as_bytes()).to_bytes().to_vec()
}

pub fn json_u64(value: &serde_json::Value) -> u64 {
    match value {
        serde_json::Value::String(s) => s.parse().expect("u64 string"),
        serde_json::Value::Number(n) => n.as_u64().expect("u64 number"),
        other => panic!("expected u64, got {other}"),
    }
}
