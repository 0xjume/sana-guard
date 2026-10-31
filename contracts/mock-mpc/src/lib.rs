use near_sdk::{near, AccountId};

/// Fixed Solana pubkey the workspaces tests use as `vault_address` ([1u8; 32]).
const VAULT_B58: &str = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";

#[near(contract_state)]
#[derive(Default)]
pub struct MockMpc {}

#[near]
impl MockMpc {
    #[init]
    pub fn new() -> Self {
        Self {}
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
}
