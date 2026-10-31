import {
  signAdminMessage,
  vaultHeaderFromAction,
  calculateRequiredDeposit,
  VAULT_STORAGE_COST,
  AGENT_STORAGE_OVERHEAD,
  removeAgentAction,
  removeRecipientAction,
  registerTokenAccountAction,
  addTokenAccountRecipientAction,
} from '../admin';
import { Ed25519Signer, OwnerAction, Policy } from '../types';
import { PublicKey } from '@solana/web3.js';

// Mock signer for tests
class MockSigner implements Ed25519Signer {
  publicKey = Buffer.from([
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  ]);

  async sign(_message: Uint8Array): Promise<Uint8Array> {
    // Return a mock 64-byte signature
    return new Uint8Array(64).fill(42);
  }
}

describe('Admin', () => {
  const signer = new MockSigner();
  const network = 'near-testnet';
  const contract = 'guard.djume.testnet';

  const mockPolicy: Policy = {
    perTxLimit: [{ mint: { type: 'sol' }, amount: BigInt(50000000) }],
    dailyCap: [{ mint: { type: 'sol' }, amount: BigInt(100000000) }],
    programs: ['11111111111111111111111111111111'],
    maxPriorityFeeLamports: BigInt(100000),
    maxTotalPriorityFeeLamports: undefined,
    maxMemoLen: 64,
    expiresAtNs: BigInt('999999999999999999'),
    loosenDelayNs: BigInt('3600000000000'),
  };

  describe('signAdminMessage', () => {
    it('should build and sign CreateVault message', async () => {
      const action: OwnerAction = {
        type: 'CreateVault',
        owner: 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB',
        vaultAddress: 'Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU',
        policy: mockPolicy,
      };

      const expiryNs = BigInt(Date.now() * 1_000_000 + 600 * 1_000_000_000);

      const signed = await signAdminMessage(network, contract, 1, expiryNs, action, signer);

      // Check message structure
      expect(signed.message).toContain('SANA-GUARD-ADMIN-v1');
      expect(signed.message).toContain('network: near-testnet');
      expect(signed.message).toContain('contract: guard.djume.testnet');
      expect(signed.message).toContain('vault: null');
      expect(signed.message).toContain('nonce: 1');
      expect(signed.message).toContain('action: {');

      // Check signature
      expect(signed.signature.length).toBe(64);
    });

    it('should build AddAgent message with correct JSON format', async () => {
      const action: OwnerAction = {
        type: 'AddAgent',
        vaultId: 0,
        name: 'agent1',
        publicKey: 'ed25519:9F5UPZQb...',
        gasFunding: BigInt('100000000000000000000000'), // 0.1 NEAR
      };

      const expiryNs = BigInt(Date.now() * 1_000_000 + 600 * 1_000_000_000);

      const signed = await signAdminMessage(network, contract, 2, expiryNs, action, signer);

      expect(signed.message).toContain('vault: 0');
      expect(signed.message).toContain('"type":"AddAgent"');
      expect(signed.message).toContain('"vault_id":0');
      expect(signed.message).toContain('"name":"agent1"');
      expect(signed.message).toContain('"gas_funding":"100000000000000000000000"');
    });

    it('should build Pause message', async () => {
      const action: OwnerAction = {
        type: 'Pause',
        vaultId: 0,
      };

      const expiryNs = BigInt(Date.now() * 1_000_000 + 600 * 1_000_000_000);

      const signed = await signAdminMessage(network, contract, 3, expiryNs, action, signer);

      expect(signed.message).toContain('"type":"Pause"');
      expect(signed.message).toContain('"vault_id":0');
    });

    it('should build SetPolicy message with proper mint encoding', async () => {
      const policy: Policy = {
        perTxLimit: [
          { mint: { type: 'sol' }, amount: BigInt(50000000) },
          {
            mint: {
              type: 'spl',
              address: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
            },
            amount: BigInt(1000000),
          },
        ],
        dailyCap: [{ mint: { type: 'sol' }, amount: BigInt(100000000) }],
        programs: ['11111111111111111111111111111111'],
        maxPriorityFeeLamports: BigInt(100000),
        maxTotalPriorityFeeLamports: undefined,
        maxMemoLen: 64,
        expiresAtNs: BigInt('999999999999999999'),
        loosenDelayNs: BigInt('3600000000000'),
      };

      const action: OwnerAction = {
        type: 'SetPolicy',
        vaultId: 0,
        policy,
      };

      const expiryNs = BigInt(Date.now() * 1_000_000 + 600 * 1_000_000_000);

      const signed = await signAdminMessage(network, contract, 4, expiryNs, action, signer);

      expect(signed.message).toContain('"type":"SetPolicy"');
      expect(signed.message).toContain('"per_tx_limit"');
      expect(signed.message).toContain('Sol'); // SOL mint format (not "SOL")
      expect(signed.message).toContain('Spl'); // SPL mint format
      expect(signed.message).not.toContain('"SOL"'); // Should not use "SOL" string
    });
  });

  describe('calculateRequiredDeposit', () => {
    it('should return VAULT_STORAGE_COST for CreateVault', () => {
      const action: OwnerAction = {
        type: 'CreateVault',
        owner: 'test',
        vaultAddress: 'test',
        policy: mockPolicy,
      };

      expect(calculateRequiredDeposit(action)).toBe(VAULT_STORAGE_COST);
    });

    it('should return gas_funding + overhead for AddAgent', () => {
      const gasFunding = BigInt('100000000000000000000000');
      const action: OwnerAction = {
        type: 'AddAgent',
        vaultId: 0,
        name: 'agent1',
        publicKey: 'ed25519:test',
        gasFunding,
      };

      expect(calculateRequiredDeposit(action)).toBe(gasFunding + AGENT_STORAGE_OVERHEAD);
    });

    it('should return 0 for other actions', () => {
      const pauseAction: OwnerAction = { type: 'Pause', vaultId: 0 };
      expect(calculateRequiredDeposit(pauseAction)).toBe(BigInt(0));

      const addRecipientAction: OwnerAction = {
        type: 'AddRecipient',
        vaultId: 0,
        recipient: 'test',
      };
      expect(calculateRequiredDeposit(addRecipientAction)).toBe(BigInt(0));
    });
  });

  describe('admin message format against contract test vectors', () => {
    /**
     * Match the exact format that the contract's tests_admin_signatures.rs expects
     */
    it('should produce message format matching contract signature tests', async () => {
      // From contract test: deterministic_signing_key() uses [7u8; 32]
      // So our MockSigner's publicKey should match

      const action: OwnerAction = {
        type: 'CreateVault',
        owner: 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB',
        vaultAddress: 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB',
        policy: {
          perTxLimit: [],
          dailyCap: [],
          programs: [],
          maxPriorityFeeLamports: BigInt(1000000),
          maxTotalPriorityFeeLamports: undefined,
          maxMemoLen: 100,
          expiresAtNs: BigInt('999999999999999999'),
          loosenDelayNs: BigInt('3600000000000'),
        },
      };

      const expiryNs = BigInt('1000000000000000000'); // Fixed for reproducibility

      const signed = await signAdminMessage(network, contract, 1, expiryNs, action, signer);

      // Expected format (7 lines):
      const lines = signed.message.split('\n');
      expect(lines.length).toBe(7);
      expect(lines[0]).toBe('SANA-GUARD-ADMIN-v1');
      expect(lines[1]).toBe('network: near-testnet');
      expect(lines[2]).toBe('contract: guard.djume.testnet');
      expect(lines[3]).toBe('vault: null');
      expect(lines[4]).toBe('nonce: 1');
      expect(lines[5]).toBe('expires: 1000000000000000000');
      expect(lines[6]).toMatch(/^action: \{/);

      // Action JSON must be compact (no spaces after : or ,)
      const actionLine = lines[6].slice('action: '.length);
      const parsedAction = JSON.parse(actionLine);
      expect(parsedAction.type).toBe('CreateVault');
      expect(parsedAction.owner).toBe('DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB');

      // Check that mints are formatted as 'Sol' not 'SOL'
      expect(actionLine).not.toContain('"SOL"');
    });
  });

  describe('vaultHeaderFromAction', () => {
    it('uses null for CreateVault and vaultId for every other action', () => {
      expect(
        vaultHeaderFromAction({
          type: 'CreateVault',
          owner: 'o',
          vaultAddress: 'v',
          policy: mockPolicy,
        })
      ).toBeNull();
      expect(vaultHeaderFromAction({ type: 'Pause', vaultId: 7 })).toBe(7);
      expect(vaultHeaderFromAction({ type: 'RemoveAgent', vaultId: 3, agent: 'a' })).toBe(3);
    });
  });

  describe('exported admin helpers', () => {
    it('builds RemoveAgent, RemoveRecipient and RegisterTokenAccount messages', async () => {
      const removeAgent = await removeAgentAction(network, contract, 2, 5, 'agent.near', signer);
      expect(removeAgent.message).toContain('vault: 2');
      expect(removeAgent.message).toContain('"type":"RemoveAgent"');
      expect(removeAgent.message).toContain('"agent":"agent.near"');

      const removeRecipient = await removeRecipientAction(
        network,
        contract,
        2,
        6,
        'Recipient111111111111111111111111111111111',
        signer
      );
      expect(removeRecipient.message).toContain('"type":"RemoveRecipient"');
      expect(removeRecipient.message).toContain(
        '"recipient":"Recipient111111111111111111111111111111111"'
      );

      const register = await registerTokenAccountAction(
        network,
        contract,
        2,
        7,
        'Ata111111111111111111111111111111111111111',
        'Mint111111111111111111111111111111111111111',
        6,
        signer
      );
      expect(register.message).toContain('"type":"RegisterTokenAccount"');
      expect(register.message).toContain('"ata":"Ata111111111111111111111111111111111111111"');
      expect(register.message).toContain('"decimals":6');
    });

    it('addTokenAccountRecipientAction allowlists the recipient ATA, not the wallet', async () => {
      const { getAssociatedTokenAddress } = await import('@solana/spl-token');
      const recipient = new PublicKey('DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB');
      const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const ata = await getAssociatedTokenAddress(mint, recipient);

      const signed = await addTokenAccountRecipientAction(
        network,
        contract,
        0,
        8,
        recipient,
        mint,
        signer
      );

      expect(signed.message).toContain('"type":"AddRecipient"');
      expect(signed.message).toContain(`"recipient":"${ata.toBase58()}"`);
      expect(signed.message).not.toContain(`"recipient":"${recipient.toBase58()}"`);
    });
  });
});
