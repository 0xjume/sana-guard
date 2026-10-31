import { describe, it, expect } from 'vitest';
import { NearClientImpl } from './near/client.js';
import { parseAdminMessage } from './validation.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { readFile } from 'fs/promises';

const isLive = process.env.RELAY_LIVE === '1';

describe.skipIf(!isLive)('Live NEAR integration (AddRecipient on testnet)', () => {
  it('submits a real AddRecipient and gets a tx hash', async () => {
    const ownerKeyPath = process.env.OWNER_KEY_PATH;
    if (!ownerKeyPath) {
      throw new Error('OWNER_KEY_PATH required for live test');
    }

    const keyData = JSON.parse(await readFile(ownerKeyPath, 'utf-8'));
    const secretKey = new Uint8Array(keyData.slice(0, 64));
    const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
    const ownerPubkey = bs58.encode(keyPair.publicKey);

    const client = new NearClientImpl(
      'testnet',
      'https://rpc.testnet.near.org',
      process.env.RELAY_ACCOUNT_ID || 'relay.djume.testnet',
      process.env.RELAY_NEAR_PRIVATE_KEY || 'ed25519:test',
      'guard.djume.testnet'
    );
    await client.init();

    const currentNonce = await client.getOwnerNonce(ownerPubkey);
    const nonce = currentNonce + 1;
    const expiry = (BigInt(Date.now()) * 1_000_000n + 600_000_000_000n).toString();

    const action = {
      type: 'AddRecipient',
      vault_id: 0,
      recipient: 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB',
    };

    const msg = [
      'SANA-GUARD-ADMIN-v1',
      'network: near-testnet',
      'contract: guard.djume.testnet',
      'vault: 0',
      `nonce: ${nonce}`,
      `expires: ${expiry}`,
      `action: ${JSON.stringify(action)}`,
    ].join('\n');

    const msgBytes = new TextEncoder().encode(msg);
    const signature = nacl.sign.detached(msgBytes, secretKey);

    const parsed = parseAdminMessage(msg);
    expect(parsed.network).toBe('near-testnet');
    expect(parsed.contract).toBe('guard.djume.testnet');
    expect(parsed.vault).toBe(0);
    expect(parsed.nonce).toBe(nonce);

    const result = await client.submitOwnerAction(
      msg,
      Array.from(signature),
      '0',
      '100000000000000'
    );

    expect(result.txHash).toBeTruthy();
    expect(result.txHash).not.toBe('unknown');
    expect(result.success).toBe(true);

    console.log('Live test tx hash:', result.txHash);
  }, 60000);
});
