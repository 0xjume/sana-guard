// Test helpers for activating vaults without MPC calls
#[cfg(test)]
use crate::*;

#[cfg(test)]
impl Guard {
    /// Test-only helper to activate a vault without MPC verification
    pub fn activate_vault_for_test(&mut self, vault_id: u32) {
        if let Some(vault) = self.vaults.get_mut(&vault_id) {
            vault.state = VaultState::Active;
            emit_event(Event::VaultCreated {
                vault_id,
                owner: base58_encode(&vault.owner),
                vault_address: base58_encode(&vault.vault_address),
            });
        }
    }
}
