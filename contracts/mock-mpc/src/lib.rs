use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId, NearToken};

/// Fixed Solana pubkey the workspaces tests use as `vault_address` ([1u8; 32]).
const VAULT_B58: &str = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";

#[near(contract_state)]
#[derive(Default)]
pub struct MockMpc {
    /// When true, `sign` panics so the guard's callback sees a failed promise.
    fail_sign: bool,
    sign_calls: u32,
}

#[near]
impl MockMpc {
    #[init]
    pub fn new() -> Self {
        Self::default()
    }

    /// Live MPC ABI: returns `"ed25519:<b58>"` (near-sdk PublicKey).
    pub fn derived_public_key(
        &self,
        path: String,
        predecessor: AccountId,
        domain_id: u32,
    ) -> String {
        let _ = (path, predecessor, domain_id);
        format!("ed25519:{VAULT_B58}")
    }

    /// Live MPC response shape for domain 1: `{"scheme":"Ed25519","signature":[64 bytes]}`.
    /// The guard only checks the shape and length, so a fixed signature is enough.
    #[payable]
    pub fn sign(&mut self, request: Value) -> Value {
        if env::attached_deposit() != NearToken::from_yoctonear(1) {
            env::panic_str("mock MPC expects exactly 1 yocto, like v1.signer");
        }
        let payload = request["payload_v2"]["Eddsa"].as_str().unwrap_or_default();
        if payload.is_empty() || request["domain_id"] != 1 {
            env::panic_str("mock MPC: malformed sign request");
        }
        self.sign_calls += 1;
        if self.fail_sign {
            env::panic_str("mock MPC: signing failed");
        }
        json!({ "scheme": "Ed25519", "signature": vec![7u8; 64] })
    }

    pub fn set_fail_sign(&mut self, fail: bool) {
        self.fail_sign = fail;
    }

    pub fn sign_calls(&self) -> u32 {
        self.sign_calls
    }
}
