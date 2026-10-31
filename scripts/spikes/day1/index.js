#!/usr/bin/env node

import { config } from 'dotenv';
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';

config();

const NEAR_NETWORK = process.env.NEAR_NETWORK || 'testnet';
const MPC_CONTRACT = process.env.MPC_CONTRACT || 'v1.signer-prod.testnet';
const GUARD_CONTRACT = process.env.GUARD_CONTRACT || 'guard.djume.testnet';
const VAULT_OWNER = process.env.VAULT_OWNER || 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';
const VAULT_ID = process.env.VAULT_ID || '0';

const RPC_URLS = {
  testnet: 'https://rpc.testnet.near.org',
  mainnet: 'https://rpc.mainnet.near.org',
};

async function derivedPublicKey(path, predecessor, mpcContract, network) {
  const url = RPC_URLS[network];
  if (!url) {
    throw new Error(`Unknown network: ${network}`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'dontcare',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: mpcContract,
        method_name: 'derived_public_key',
        args_base64: Buffer.from(JSON.stringify({ path, predecessor, domain_id: 1 })).toString(
          'base64'
        ),
      },
    }),
  });

  const json = await response.json();

  if (json.error) {
    throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  }

  const resultBytes = Buffer.from(json.result.result);
  const resultJson = JSON.parse(resultBytes.toString());

  const pubkeyStr = resultJson.public_key;
  if (!pubkeyStr.startsWith('ed25519:')) {
    throw new Error(`Unexpected public key format: ${pubkeyStr}`);
  }

  const pubkeyBase58 = pubkeyStr.slice('ed25519:'.length);
  const pubkeyBytes = bs58.decode(pubkeyBase58);

  return {
    ed25519: pubkeyBase58,
    bytes: Array.from(pubkeyBytes),
  };
}

async function buildSolanaTransfer(fromPubkey, toPubkey, lamports, connection) {
  const blockhash = await connection.getLatestBlockhash('finalized');

  const transaction = new Transaction({
    feePayer: fromPubkey,
    recentBlockhash: blockhash.blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    })
  );

  const message = transaction.compileMessage();
  return {
    message: message.serialize(),
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
  };
}

async function main() {
  console.log('Sana Guard Day 1 Spike: MPC Derivation + Solana Message Build\n');

  const path = `vault/${VAULT_OWNER}/${VAULT_ID}`;
  console.log(`Network: ${NEAR_NETWORK}`);
  console.log(`MPC Contract: ${MPC_CONTRACT}`);
  console.log(`Guard Contract: ${GUARD_CONTRACT}`);
  console.log(`Vault Path: ${path}\n`);

  console.log('Step 1: Deriving vault Ed25519 public key from MPC...');
  const derived = await derivedPublicKey(path, GUARD_CONTRACT, MPC_CONTRACT, NEAR_NETWORK);
  console.log(`Derived Ed25519 public key: ${derived.ed25519}`);
  console.log(`Bytes (32): [${derived.bytes.join(', ')}]\n`);

  const vaultPubkey = new PublicKey(derived.bytes);
  console.log(`Solana address: ${vaultPubkey.toBase58()}\n`);

  console.log('Step 2: Building a Solana devnet transfer message...');
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  const recipientPubkey = new PublicKey('11111111111111111111111111111111');
  const lamports = 1000;

  const { message, blockhash, lastValidBlockHeight } = await buildSolanaTransfer(
    vaultPubkey,
    recipientPubkey,
    lamports,
    connection
  );

  console.log(`Recent blockhash: ${blockhash}`);
  console.log(`Last valid block height: ${lastValidBlockHeight}`);
  console.log(`Message bytes (${message.length}): ${message.toString('hex')}\n`);

  console.log('Step 3: MPC Signature Request Payload');
  console.log('Call the guard contract request_sign with:');
  console.log(
    JSON.stringify(
      {
        vault_id: parseInt(VAULT_ID, 10),
        message_b64: message.toString('base64'),
        req_id_b64: Buffer.from(Array(32).fill(1)).toString('base64'), // dummy req_id
      },
      null,
      2
    )
  );
  console.log('\n');

  console.log('Step 4: Next Actions');
  console.log(`- Fund vault ${vaultPubkey.toBase58()} on Solana devnet`);
  console.log(`- Deploy guard contract to ${GUARD_CONTRACT}`);
  console.log(`- Create a vault with owner ${VAULT_OWNER} and vault_id ${VAULT_ID}`);
  console.log(`- Call request_sign and measure latency + gas`);
  console.log(`- Broadcast the signed transaction to Solana devnet\n`);

  console.log('Spike complete. Document results in docs/spikes.md');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
