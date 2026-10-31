'use strict';

const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const bs58mod = require('bs58');
const bs58 = bs58mod.default || bs58mod;

const { signAdminMessage } = require('../dist/admin');

const seed = Buffer.alloc(32, 0x07);
const keypair = nacl.sign.keyPair.fromSeed(seed);
const owner = bs58.encode(keypair.publicKey);

const signer = {
  publicKey: keypair.publicKey,
  sign(message) {
    return nacl.sign.detached(message, keypair.secretKey);
  },
};

const network = 'near-testnet';
const contract = 'guard.djume.testnet';
const nonce = 42;
const expiryNs = BigInt('1800000000000000000');

const basePolicy = {
  perTxLimit: [{ mint: { type: 'sol' }, amount: BigInt(50000000) }],
  dailyCap: [{ mint: { type: 'sol' }, amount: BigInt(100000000) }],
  programs: ['11111111111111111111111111111111'],
  maxPriorityFeeLamports: BigInt(100000),
  maxMemoLen: 64,
  expiresAtNs: BigInt('999999999999999999'),
  loosenDelayNs: BigInt('3600000000000'),
};

async function main() {
  const createVault = await signAdminMessage(
    network,
    contract,
    nonce,
    expiryNs,
    {
      type: 'CreateVault',
      owner,
      vaultAddress: owner,
      policy: { ...basePolicy },
    },
    signer
  );

  const setPolicy = await signAdminMessage(
    network,
    contract,
    nonce,
    expiryNs,
    {
      type: 'SetPolicy',
      vaultId: 0,
      policy: { ...basePolicy },
    },
    signer
  );

  const setPolicyWithMaxTotal = await signAdminMessage(
    network,
    contract,
    nonce,
    expiryNs,
    {
      type: 'SetPolicy',
      vaultId: 0,
      policy: {
        ...basePolicy,
        maxTotalPriorityFeeLamports: BigInt(250000),
      },
    },
    signer
  );

  const backfill = await signAdminMessage(
    network,
    contract,
    nonce,
    expiryNs,
    {
      type: 'BackfillRecipients',
      vaultId: 0,
      recipients: ['DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB'],
    },
    signer
  );

  const out = {
    seed: '07'.repeat(32),
    owner,
    nonce,
    expires: '1800000000000000000',
    cases: [
      { name: 'CreateVault', message: createVault.message, signatureHex: Buffer.from(createVault.signature).toString('hex') },
      { name: 'SetPolicy', message: setPolicy.message, signatureHex: Buffer.from(setPolicy.signature).toString('hex') },
      {
        name: 'SetPolicyWithMaxTotalPriorityFee',
        message: setPolicyWithMaxTotal.message,
        signatureHex: Buffer.from(setPolicyWithMaxTotal.signature).toString('hex'),
      },
      { name: 'BackfillRecipients', message: backfill.message, signatureHex: Buffer.from(backfill.signature).toString('hex') },
    ],
  };

  const dest = path.join(__dirname, '../src/__tests__/fixtures/admin-messages.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote', dest);
  for (const c of out.cases) {
    console.log(c.name, c.signatureHex.slice(0, 16) + '...');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
