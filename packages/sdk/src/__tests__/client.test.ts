import { Connection, PublicKey } from '@solana/web3.js';
import { Account as NearAccount } from 'near-api-js';
import nacl from 'tweetnacl';
import {
  AgentClient,
  validateIdempotencyKey,
  inferSolanaCluster,
  solanaExplorerUrl,
  extractNearTxHash,
} from '../client';
import { SanaGuardError, SanaGuardSignError } from '../errors';

function validKey(): string {
  return 'ab'.repeat(32);
}

function signedFixture() {
  const keypair = nacl.sign.keyPair();
  const vaultAddress = new PublicKey(keypair.publicKey);
  const message = new Uint8Array([1, 2, 3, 4, 5]);
  const signature = nacl.sign.detached(message, keypair.secretKey);
  return { vaultAddress, message, signature };
}

function mockClient(functionCall: jest.Mock, vaultAddress: PublicKey): AgentClient {
  const nearAccount = { functionCall } as unknown as NearAccount;
  return new AgentClient({} as Connection, nearAccount, 'guard.djume.testnet', vaultAddress);
}

describe('validateIdempotencyKey', () => {
  it('accepts 64 lowercase hex characters', () => {
    expect(() => validateIdempotencyKey(validKey())).not.toThrow();
  });

  it('rejects uppercase, short, and non-hex keys', () => {
    expect(() => validateIdempotencyKey('AB'.repeat(32))).toThrow(SanaGuardError);
    expect(() => validateIdempotencyKey('ab'.repeat(31))).toThrow(
      'idempotencyKey must be 64 lowercase hex characters (32 bytes)'
    );
    expect(() => validateIdempotencyKey('gg'.repeat(32))).toThrow(SanaGuardError);
    expect(() => validateIdempotencyKey('')).toThrow(SanaGuardError);
  });
});

describe('AgentClient.requestSign', () => {
  it('returns the signature together with the request id', async () => {
    const { vaultAddress, message, signature } = signedFixture();
    const functionCall = jest.fn().mockResolvedValue(Array.from(signature));
    const client = mockClient(functionCall, vaultAddress);
    const requestId = validKey();

    const result = await client.requestSign({
      vaultId: 0,
      message,
      idempotencyKey: requestId,
    });

    expect(result.requestId).toBe(requestId);
    expect(result.nearTxHash).toBeUndefined();
    expect(Buffer.from(result.signature).equals(Buffer.from(signature))).toBe(true);
    expect(functionCall).toHaveBeenCalledWith(
      expect.objectContaining({
        methodName: 'request_sign',
        args: expect.objectContaining({ req_id_hex: requestId }),
      })
    );
  });

  it('generates a 64-char lowercase hex request id when omitted', async () => {
    const { vaultAddress, message, signature } = signedFixture();
    const functionCall = jest.fn().mockResolvedValue(Array.from(signature));
    const client = mockClient(functionCall, vaultAddress);

    const result = await client.requestSign({ vaultId: 0, message });

    expect(result.requestId).toMatch(/^[0-9a-f]{64}$/);
    expect(functionCall.mock.calls[0][0].args.req_id_hex).toBe(result.requestId);
  });

  it('rejects an invalid idempotencyKey before calling the contract', async () => {
    const { vaultAddress, message } = signedFixture();
    const functionCall = jest.fn();
    const client = mockClient(functionCall, vaultAddress);

    await expect(
      client.requestSign({ vaultId: 0, message, idempotencyKey: 'ABC' })
    ).rejects.toThrow('idempotencyKey must be 64 lowercase hex characters (32 bytes)');
    expect(functionCall).not.toHaveBeenCalled();
  });

  it('throws SanaGuardSignError with requestId when functionCall throws', async () => {
    const { vaultAddress, message } = signedFixture();
    const functionCall = jest.fn().mockRejectedValue(new Error('timeout'));
    const client = mockClient(functionCall, vaultAddress);
    const requestId = validKey();

    try {
      await client.requestSign({ vaultId: 0, message, idempotencyKey: requestId });
      throw new Error('expected requestSign to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SanaGuardSignError);
      expect((error as SanaGuardSignError).requestId).toBe(requestId);
      expect((error as SanaGuardSignError).message).toBe('timeout');
    }
  });

  it('throws SanaGuardSignError when on_signed returns null', async () => {
    const { vaultAddress, message } = signedFixture();
    const functionCall = jest.fn().mockResolvedValue({
      status: { SuccessValue: Buffer.from('null').toString('base64') },
    });
    const client = mockClient(functionCall, vaultAddress);
    const requestId = validKey();

    await expect(
      client.requestSign({ vaultId: 0, message, idempotencyKey: requestId })
    ).rejects.toMatchObject({
      name: 'SanaGuardSignError',
      requestId,
      message: 'request_sign returned no signature',
    });
  });

  it('throws SanaGuardSignError when the result is empty or the wrong length', async () => {
    const { vaultAddress, message } = signedFixture();
    const empty = jest.fn().mockResolvedValue({
      status: { SuccessValue: '' },
    });
    const short = jest.fn().mockResolvedValue([1, 2, 3]);

    await expect(
      mockClient(empty, vaultAddress).requestSign({
        vaultId: 0,
        message,
        idempotencyKey: validKey(),
      })
    ).rejects.toBeInstanceOf(SanaGuardSignError);

    try {
      await mockClient(short, vaultAddress).requestSign({
        vaultId: 0,
        message,
        idempotencyKey: validKey(),
      });
      throw new Error('expected requestSign to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SanaGuardSignError);
      expect((error as SanaGuardSignError).requestId).toBe(validKey());
      expect((error as SanaGuardSignError).message).toBe('Invalid MPC signature format');
    }
  });

  it('throws SanaGuardSignError when local signature verification fails', async () => {
    const { vaultAddress, message } = signedFixture();
    const bogus = new Uint8Array(64).fill(1);
    const functionCall = jest.fn().mockResolvedValue(Array.from(bogus));
    const client = mockClient(functionCall, vaultAddress);
    const requestId = validKey();

    try {
      await client.requestSign({ vaultId: 0, message, idempotencyKey: requestId });
      throw new Error('expected requestSign to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SanaGuardSignError);
      expect((error as SanaGuardSignError).requestId).toBe(requestId);
      expect((error as SanaGuardSignError).message).toBe('Signature verification failed');
    }
  });

  it('maps contract panic codes onto SanaGuardSignError', async () => {
    const { vaultAddress, message } = signedFixture();
    const functionCall = jest
      .fn()
      .mockRejectedValue(new Error('Smart contract panicked: SG_E058_INVALID_REQ_ID'));
    const client = mockClient(functionCall, vaultAddress);
    const requestId = validKey();

    try {
      await client.requestSign({ vaultId: 0, message, idempotencyKey: requestId });
      throw new Error('expected requestSign to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SanaGuardSignError);
      expect((error as SanaGuardSignError).code).toBe('SG_E058_INVALID_REQ_ID');
      expect((error as SanaGuardSignError).requestId).toBe(requestId);
    }
  });

  it('returns the NEAR transaction hash when the functionCall outcome includes one', async () => {
    const { vaultAddress, message, signature } = signedFixture();
    const functionCall = jest.fn().mockResolvedValue({
      status: {
        SuccessValue: Buffer.from(JSON.stringify(Array.from(signature))).toString('base64'),
      },
      transaction: { hash: 'NEAR_TX_HASH_ABC' },
    });
    const client = mockClient(functionCall, vaultAddress);

    const result = await client.requestSign({
      vaultId: 0,
      message,
      idempotencyKey: validKey(),
    });

    expect(result.nearTxHash).toBe('NEAR_TX_HASH_ABC');
  });
});

describe('explorer cluster inference', () => {
  it('never defaults a custom RPC to mainnet-beta', () => {
    expect(inferSolanaCluster('https://solana-rpc.publicnode.com')).toBe('custom');
    expect(inferSolanaCluster('https://rpc.ankr.com/solana')).toBe('custom');
    expect(inferSolanaCluster('https://api.devnet.solana.com')).toBe('devnet');
    expect(solanaExplorerUrl('Sig111', 'custom', 'https://rpc.ankr.com/solana')).toBe(
      'https://explorer.solana.com/tx/Sig111?cluster=custom&customUrl=https%3A%2F%2Frpc.ankr.com%2Fsolana'
    );
    expect(solanaExplorerUrl('Sig111', 'devnet')).toContain('cluster=devnet');
    expect(solanaExplorerUrl('Sig111', 'custom')).not.toContain('mainnet-beta');
  });

  it('extracts a NEAR tx hash from functionCall outcomes', () => {
    expect(extractNearTxHash({ transaction: { hash: 'abc' } })).toBe('abc');
    expect(extractNearTxHash({ transaction_outcome: { id: 'def' } })).toBe('def');
    expect(extractNearTxHash(Array.from({ length: 64 }, () => 1))).toBeUndefined();
  });
});
