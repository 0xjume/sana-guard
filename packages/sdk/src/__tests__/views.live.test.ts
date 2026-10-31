/**
 * Live integration tests against guard.djume.testnet
 *
 * Only run when SANA_GUARD_LIVE=1
 * Never sends transactions in CI
 */

import { Views } from '../views';
import { connect, keyStores } from 'near-api-js';

const LIVE = process.env.SANA_GUARD_LIVE === '1';

(LIVE ? describe : describe.skip)('Views (live)', () => {
  let views: Views;

  beforeAll(async () => {
    // Connect to NEAR testnet with a throwaway account (read-only)
    const keyStore = new keyStores.InMemoryKeyStore();
    const config = {
      networkId: 'testnet',
      keyStore,
      nodeUrl: 'https://rpc.testnet.near.org',
      walletUrl: 'https://wallet.testnet.near.org',
      helperUrl: 'https://helper.testnet.near.org',
    };

    const near = await connect(config);
    const account = await near.account('test.testnet'); // Read-only account

    views = new Views(account, 'guard.djume.testnet');
  });

  it('should get vault 0', async () => {
    const vault = await views.getVault(0);

    expect(vault).not.toBeNull();
    if (vault) {
      expect(vault.owner).toBeTruthy();
      expect(vault.vaultAddress).toBeTruthy();
      expect(vault.path).toBeTruthy();
      expect(vault.policy).toBeTruthy();
      expect(typeof vault.paused).toBe('boolean');
      expect(vault.state).toBe('Active');

      // Assert that SOL mint is properly parsed as 'sol' type
      expect(vault.policy.perTxLimit.length).toBeGreaterThan(0);
      expect(vault.policy.perTxLimit[0].mint.type).toBe('sol');

      console.log('Vault 0:', {
        owner: vault.owner,
        vaultAddress: vault.vaultAddress,
        path: vault.path,
        paused: vault.paused,
        state: vault.state,
      });
    }
  }, 30000);

  it('should get owner nonce', async () => {
    // Owner from E2E-TESTNET.md
    const ownerB58 = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';
    const nonce = await views.getNonce(ownerB58);

    expect(typeof nonce).toBe('number');
    expect(nonce).toBeGreaterThanOrEqual(0);

    console.log(`Owner ${ownerB58} nonce: ${nonce}`);
  }, 30000);

  it('should get recipients for vault 0', async () => {
    const recipients = await views.getRecipients(0);

    expect(Array.isArray(recipients)).toBe(true);
    // DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB should be in the list from E2E
    expect(recipients).toContain('DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB');

    console.log('Recipients for vault 0:', recipients);
  }, 30000);

  it('should get 24h spend for vault 0', async () => {
    const spend = await views.getSpend24h(0);

    expect(Array.isArray(spend)).toBe(true);

    console.log('24h spend for vault 0:', spend);
  }, 30000);

  it('should list vaults', async () => {
    const vaults = await views.listVaults(0, 10);

    expect(Array.isArray(vaults)).toBe(true);
    expect(vaults.length).toBeGreaterThan(0);

    console.log(`Found ${vaults.length} vaults`);
  }, 30000);

  it('should get supported programs', async () => {
    const programs = await views.supportedPrograms();

    expect(Array.isArray(programs)).toBe(true);
    expect(programs.length).toBeGreaterThan(0);

    // Should include System, Token, ATA, ComputeBudget, Memo
    expect(programs).toContain('11111111111111111111111111111111'); // System
    expect(programs).toContain('ComputeBudget111111111111111111111111111111'); // ComputeBudget
    expect(programs).toContain('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'); // Memo

    console.log('Supported programs:', programs);
  }, 30000);

  it('should derive vault address via MPC', async () => {
    const ownerPublicKey = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';
    const vaultIndex = 0;

    const vaultAddress = await views.deriveVaultAddress(
      'v1.signer-prod.testnet',
      ownerPublicKey,
      vaultIndex,
      1 // domain_id for testnet
    );

    expect(vaultAddress).toBeTruthy();
    expect(vaultAddress.toBase58()).toBe('Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU');

    console.log('Derived vault address:', vaultAddress.toBase58());
  }, 30000);

  it('should handle non-existent vault', async () => {
    const vault = await views.getVault(999999);
    expect(vault).toBeNull();
  }, 30000);

  it('should handle non-existent request', async () => {
    const reqId = '0'.repeat(64);
    const request = await views.getRequest(reqId);
    expect(request).toBeNull();
  }, 30000);
});
