# Sana Guard TypeScript SDK

TypeScript SDK for [Sana Guard](https://github.com/0xjume/sana-guard) – policy-enforced AI agent wallets on Solana via NEAR Chain Signatures.

**Status**: Under active development. Tested against `guard.djume.testnet` (main@1648579).

## Features

- **Solana Message Building**: SystemProgram transfer, SPL Token transfer/transferChecked, ATA create-idempotent, ComputeBudget, Memo
- **Agent Client**: `requestSign` with agent function-call key, local signature verification, and automatic broadcast
- **Owner/Admin Client**: Build and sign owner admin messages (CreateVault, SetPolicy, AddRecipient, AddTokenAccountRecipient, AddAgent, RemoveAgent, RemoveRecipient, RegisterTokenAccount, Pause/Unpause, Release)
- **Views**: Query vaults, recipients, 24h spend, nonce, and derive vault addresses via MPC
- **Typed Errors**: Map every `SG_E###` contract error code to a readable error class
- **Tests**: Unit tests, golden fixtures, and opt-in live tests against `guard.djume.testnet`

## Installation

```bash
npm install @sana-guard/sdk near-api-js @solana/web3.js
# or
pnpm add @sana-guard/sdk near-api-js @solana/web3.js
```

## Quickstart: Agent

An AI agent using its NEAR function-call key to sign and broadcast Solana transactions:

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { connect, keyStores, KeyPair } from 'near-api-js';
import { AgentClient } from '@sana-guard/sdk';

// 1. Connect to NEAR and Solana
const nearKeyStore = new keyStores.UnencryptedFileSystemKeyStore('/path/to/.near-credentials');
const nearConfig = {
  networkId: 'testnet',
  keyStore: nearKeyStore,
  nodeUrl: 'https://rpc.testnet.near.org',
};
const near = await connect(nearConfig);
const agentAccount = await near.account('agent1.guard.djume.testnet');

const solanaConnection = new Connection('https://api.devnet.solana.com', 'confirmed');

// 2. Create agent client
const vaultAddress = new PublicKey('Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU');
const client = new AgentClient(
  solanaConnection,
  agentAccount,
  'guard.djume.testnet',
  vaultAddress
);

// 3. Transfer 0.01 SOL from vault 0 (optional memo)
const result = await client.transfer(
  0,
  {
    to: new PublicKey('DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB'),
    lamports: BigInt(10_000_000),
  },
  { memo: 'agent payout' }
);

console.log('Transaction:', result.explorer);
// => https://explorer.solana.com/tx/...?cluster=devnet
```

## Quickstart: Owner

A vault owner using an ed25519 wallet (e.g. Privy embedded Solana wallet) to sign admin messages:

```typescript
import { connect, keyStores } from 'near-api-js';
import { createVaultAction, addRecipientAction, addTokenAccountRecipientAction, pauseAction, VAULT_STORAGE_COST, Views } from '@sana-guard/sdk';
import { Ed25519Signer } from '@sana-guard/sdk';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

// 1. Create an Ed25519 signer (e.g. from Privy embedded wallet or local keypair)
class Ed25519SignerImpl implements Ed25519Signer {
  constructor(private keypair: nacl.SignKeyPair) {}

  get publicKey(): Uint8Array {
    return this.keypair.publicKey;
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return nacl.sign.detached(message, this.keypair.secretKey);
  }
}

// Load owner keypair (Solana ed25519 key)
const ownerSecretKey = bs58.decode('YOUR_SOLANA_PRIVATE_KEY_BASE58');
const ownerKeypair = nacl.sign.keyPair.fromSecretKey(ownerSecretKey);
const signer = new Ed25519SignerImpl(ownerKeypair);

// 2. Connect to NEAR (relay account will submit the signed message)
const nearKeyStore = new keyStores.InMemoryKeyStore(); // relay's key
const nearConfig = { networkId: 'testnet', keyStore: nearKeyStore, nodeUrl: 'https://rpc.testnet.near.org' };
const near = await connect(nearConfig);
const relayAccount = await near.account('relay.djume.testnet');

// 3. Create a vault
const ownerB58 = bs58.encode(ownerKeypair.publicKey);
const vaultAddressB58 = 'Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU'; // Pre-computed via MPC

const views = new Views(relayAccount, 'guard.djume.testnet');
const nonce = (await views.getNonce(ownerB58)) + 1;

const createVaultMsg = await createVaultAction(
  'near-testnet',
  'guard.djume.testnet',
  nonce,
  {
    owner: ownerB58,
    vaultAddress: vaultAddressB58,
    policy: {
      perTxLimit: [{ mint: { type: 'sol' }, amount: BigInt(50_000_000) }], // 0.05 SOL
      dailyCap: [{ mint: { type: 'sol' }, amount: BigInt(100_000_000) }], // 0.1 SOL
      programs: ['11111111111111111111111111111111'], // System only
      maxPriorityFeeLamports: BigInt(100_000),
      maxMemoLen: 64,
      expiresAtNs: BigInt(Date.now() * 1_000_000 + 30 * 24 * 3600 * 1_000_000_000), // 30 days
      loosenDelayNs: BigInt(3600 * 1_000_000_000), // 1 hour
    },
  },
  signer
);

// 4. Submit via relay (attach 0.5 NEAR for storage)
const contract = new nearApi.Contract(relayAccount, 'guard.djume.testnet', {
  changeMethods: ['owner_action'],
  viewMethods: [],
});

const result = await contract.owner_action(
  { msg: createVaultMsg.message, sig: Array.from(createVaultMsg.signature) },
  '100000000000000', // 100 Tgas
  VAULT_STORAGE_COST.toString()
);

console.log('Vault created:', result);
```

## API

### Agent Client

```typescript
class AgentClient {
  constructor(
    solanaConnection: Connection,
    nearAccount: NearAccount,
    guardContract: string,
    vaultAddress: PublicKey
  );

  // Request MPC signature for a Solana message.
  // Success: { signature, requestId }. Failure: throws SanaGuardSignError with requestId.
  requestSign(params: RequestSignParams, gasAttached?: string): Promise<SignResult>;

  // Request signature and broadcast immediately
  requestSignAndBroadcast(
    params: RequestSignParams,
    gasAttached?: string,
    sendOptions?: SendOptions
  ): Promise<BroadcastResult>;

  // High-level transfer helper (SOL or SPL token)
  transfer(
    vaultId: number,
    params: TransferParams,
    options?: { computeUnitLimit?: number; computeUnitPrice?: bigint; version?: 'legacy' | 'v0'; memo?: string; maxMemoLen?: number }
  ): Promise<BroadcastResult>;
}
```

`transfer()` with `token` sends to the recipient's Associated Token Account and checks that **ATA address** against the vault recipient allowlist (`SG_E068`). Allowlisting the wallet is not enough.

- Allowlist the ATA with `addTokenAccountRecipientAction(network, contract, vaultId, nonce, recipient, mint, signer)`.
- The destination ATA must already exist. The SDK sets `createAta: false` and will not create it in the signed message.

`idempotencyKey`, when provided, must be 64 lowercase hex characters (32 bytes). On any `requestSign` failure after a request id is allocated (timeout, contract panic, or `on_signed` returning null), the SDK throws `SanaGuardSignError` carrying `requestId` so you can poll `get_request` or submit `Release`.

### Views

```typescript
class Views {
  constructor(nearAccount: NearAccount, guardContract: string);

  getVault(vaultId: number): Promise<VaultView | null>;
  getRecipients(vaultId: number, fromIndex?: number, limit?: number): Promise<string[]>;
  getRequest(reqIdHex: string): Promise<SignRequestView | null>;
  getSpend24h(vaultId: number): Promise<Array<{ mint: string; amount: bigint }>>;
  getNonce(ownerB58: string): Promise<number>;
  listVaults(from?: number, limit?: number): Promise<Array<{ id: number; vault: VaultView }>>;
  supportedPrograms(): Promise<string[]>;

  // Derive vault address via MPC derived_public_key
  deriveVaultAddress(
    mpcContract: string,
    ownerPublicKey: string,
    vaultIndex: number,
    mpcDomainId?: number
  ): Promise<PublicKey>;
}
```

### Admin (Owner)

```typescript
// Sign admin messages
signAdminMessage(
  network: string,
  contract: string,
  nonce: number,
  expiryNs: bigint,
  action: OwnerAction,
  signer: Ed25519Signer
): Promise<SignedAdminMessage>; // vault header is derived from action.vaultId (null for CreateVault)

// Helpers for each action type
createVaultAction(network, contract, nonce, params, signer, ttlSeconds?): Promise<SignedAdminMessage>;
setPolicyAction(network, contract, vaultId, nonce, policy, signer, ttlSeconds?): Promise<SignedAdminMessage>;
addRecipientAction(network, contract, vaultId, nonce, recipient, signer, ttlSeconds?): Promise<SignedAdminMessage>;
addTokenAccountRecipientAction(network, contract, vaultId, nonce, recipient, mint, signer, ttlSeconds?): Promise<SignedAdminMessage>;
addAgentAction(network, contract, nonce, params, signer, ttlSeconds?): Promise<SignedAdminMessage>;
removeAgentAction(network, contract, vaultId, nonce, agent, signer, ttlSeconds?): Promise<SignedAdminMessage>;
removeRecipientAction(network, contract, vaultId, nonce, recipient, signer, ttlSeconds?): Promise<SignedAdminMessage>;
registerTokenAccountAction(network, contract, vaultId, nonce, ata, mint, decimals, signer, ttlSeconds?): Promise<SignedAdminMessage>;
pauseAction(network, contract, vaultId, nonce, signer, ttlSeconds?): Promise<SignedAdminMessage>;
unpauseAction(network, contract, vaultId, nonce, signer, ttlSeconds?): Promise<SignedAdminMessage>;
releaseAction(network, contract, vaultId, nonce, reqId, signer, ttlSeconds?): Promise<SignedAdminMessage>;
backfillRecipientsAction(network, contract, vaultId, nonce, recipients, signer, ttlSeconds?): Promise<SignedAdminMessage>;

// Calculate required deposit
calculateRequiredDeposit(action: OwnerAction): bigint;
```

### Messages

```typescript
// Build Solana messages (v0 or legacy, NO v1/0x81)
buildSolTransfer(from, to, lamports, recentBlockhash, options?): Uint8Array;
buildTokenTransfer(from, to, mint, amount, decimals, fromTokenAccount, toTokenAccount, recentBlockhash, options?): Uint8Array;
buildMessageWithMemo(from, recentBlockhash, memo, instructions, version?): Uint8Array;

// Signature verification and assembly
verifyMessageSignature(signature, message, vaultAddress): Promise<boolean>;
assembleSignedTransaction(signature, message): Uint8Array;

// Enforce format
assertNotV1Message(message): void; // Throws if message[0] === 0x81
```

### Errors

Every `SG_E###` error code from the contract is mapped to a readable message:

```typescript
try {
  await client.transfer(vaultId, { to, lamports });
} catch (error) {
  if (isErrorCode(error, 'SG_E062_PER_TX_LIMIT_EXCEEDED')) {
    console.error('Transfer exceeds per-transaction limit');
  } else if (isErrorCode(error, 'SG_E067_RECIPIENT_NOT_ALLOWED')) {
    console.error('Recipient not in allowlist');
  } else {
    console.error('Other error:', error.message);
  }
}
```

## Testing

```bash
# Unit tests
pnpm test

# Live tests against guard.djume.testnet (read-only, never sends transactions)
SANA_GUARD_LIVE=1 pnpm test
```

## Contract Interface

This SDK is built against **Sana Guard main@1648579** (`guard.djume.testnet`). See [`contracts/guard`](../../contracts/guard) for the source of truth.

- **Agent request_sign**: `vault_id`, `message_b64`, `req_id_hex`, 0 deposit, 95 Tgas recommended
- **Owner owner_action**: `msg` (SANA-GUARD-ADMIN-v1 format), `sig` (64-byte Ed25519), payable (0.5 NEAR for CreateVault, gas_funding+0.05 NEAR for AddAgent)
- **Views**: `get_vault`, `get_request`, `get_spend_24h`, `owner_nonce`, `list_vaults`, `supported_programs`

## Message Format

- **Legacy**: No version byte, starts with header (3 bytes)
- **v0**: Version byte `0x80`, header, keys, blockhash, instructions, empty ALT list
- **v1 (0x81)**: **NOT SUPPORTED** by Sana Guard (enforced by `assertNotV1Message`)

All messages MUST:
- Use CONFIRMED blockhash (finalized blockhashes expired in E2E tests)
- Have exactly 1 required signature
- Contain 1-8 instructions
- Be 32-1167 bytes
- NOT use address lookup tables

## Error Codes

See [errors.ts](./src/errors.ts) for the full mapping. Common codes:

- `SG_E001_SIZE`: Message size out of bounds
- `SG_E016_ALT_NOT_ALLOWED`: Address lookup tables not allowed
- `SG_E051_GLOBAL_PAUSED`: Contract is globally paused
- `SG_E055_VAULT_PAUSED`: Vault is paused
- `SG_E059_DUPLICATE_REQ_ID`: Request ID already used
- `SG_E060_DUPLICATE_MSG_HASH`: Message already signed in last 24h
- `SG_E062_PER_TX_LIMIT_EXCEEDED`: Per-transaction limit exceeded
- `SG_E064_DAILY_CAP_EXCEEDED`: 24-hour spend cap exceeded
- `SG_E067_RECIPIENT_NOT_ALLOWED`: Recipient not in allowlist
- `SG_E068_RECIPIENT_NOT_ALLOWED`: Token transfer recipient ATA not in allowlist
- `SG_E074_PROGRAM_NOT_ALLOWED`: Program not in policy allowlist

## License

MIT
