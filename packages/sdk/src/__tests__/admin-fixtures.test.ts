import { readFileSync } from 'fs';
import { join } from 'path';
import nacl from 'tweetnacl';
import { signAdminMessage } from '../admin';
import { Ed25519Signer, OwnerAction, Policy } from '../types';

interface FixtureCase {
  name: string;
  message: string;
  signatureHex: string;
}

interface FixtureFile {
  owner: string;
  nonce: number;
  expires: string;
  cases: FixtureCase[];
}

class Seed07Signer implements Ed25519Signer {
  private readonly keypair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(0x07));

  get publicKey(): Uint8Array {
    return this.keypair.publicKey;
  }

  sign(message: Uint8Array): Uint8Array {
    return nacl.sign.detached(message, this.keypair.secretKey);
  }
}

const fixture: FixtureFile = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/admin-messages.json'), 'utf-8')
);

const signer = new Seed07Signer();
const network = 'near-testnet';
const contract = 'guard.djume.testnet';
const nonce = 42;
const expiryNs = BigInt('1800000000000000000');

const basePolicy: Policy = {
  perTxLimit: [{ mint: { type: 'sol' }, amount: BigInt(50000000) }],
  dailyCap: [{ mint: { type: 'sol' }, amount: BigInt(100000000) }],
  programs: ['11111111111111111111111111111111'],
  maxPriorityFeeLamports: BigInt(100000),
  maxMemoLen: 64,
  expiresAtNs: BigInt('999999999999999999'),
  loosenDelayNs: BigInt('3600000000000'),
};

function caseByName(name: string): FixtureCase {
  const found = fixture.cases.find((c) => c.name === name);
  if (!found) {
    throw new Error(`missing fixture ${name}`);
  }
  return found;
}

describe('admin message exact-byte fixtures', () => {
  it('CreateVault matches the checked-in message and signature', async () => {
    const action: OwnerAction = {
      type: 'CreateVault',
      owner: fixture.owner,
      vaultAddress: fixture.owner,
      policy: { ...basePolicy },
    };
    const signed = await signAdminMessage(network, contract, nonce, expiryNs, action, signer);
    const expected = caseByName('CreateVault');
    expect(signed.message).toBe(expected.message);
    expect(Buffer.from(signed.signature).toString('hex')).toBe(expected.signatureHex);
    expect(signed.message).not.toContain('max_total_priority_fee_lamports');
  });

  it('SetPolicy without max_total_priority_fee_lamports matches', async () => {
    const action: OwnerAction = {
      type: 'SetPolicy',
      vaultId: 0,
      policy: { ...basePolicy },
    };
    const signed = await signAdminMessage(network, contract, nonce, expiryNs, action, signer);
    const expected = caseByName('SetPolicy');
    expect(signed.message).toBe(expected.message);
    expect(Buffer.from(signed.signature).toString('hex')).toBe(expected.signatureHex);
    expect(signed.message).not.toContain('max_total_priority_fee_lamports');
  });

  it('SetPolicy with max_total_priority_fee_lamports matches', async () => {
    const action: OwnerAction = {
      type: 'SetPolicy',
      vaultId: 0,
      policy: { ...basePolicy, maxTotalPriorityFeeLamports: BigInt(250000) },
    };
    const signed = await signAdminMessage(network, contract, nonce, expiryNs, action, signer);
    const expected = caseByName('SetPolicyWithMaxTotalPriorityFee');
    expect(signed.message).toBe(expected.message);
    expect(Buffer.from(signed.signature).toString('hex')).toBe(expected.signatureHex);
    expect(signed.message).toContain('"max_total_priority_fee_lamports":"250000"');
  });

  it('BackfillRecipients matches', async () => {
    const action: OwnerAction = {
      type: 'BackfillRecipients',
      vaultId: 0,
      recipients: ['DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB'],
    };
    const signed = await signAdminMessage(network, contract, nonce, expiryNs, action, signer);
    const expected = caseByName('BackfillRecipients');
    expect(signed.message).toBe(expected.message);
    expect(Buffer.from(signed.signature).toString('hex')).toBe(expected.signatureHex);
  });
});
