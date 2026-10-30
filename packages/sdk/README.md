# Sana Guard SDK

TypeScript SDK for interacting with Sana Guard contracts and building Solana transactions.

## Features

- Derive vault addresses via MPC `derived_public_key`
- Build Solana v0/legacy messages (no v1)
- Submit `request_sign` with agent function-call key
- Assemble and broadcast signed transactions
- Parse rejection reason codes

## Status

**Placeholder** — Implementation pending (see [PLAN.md](../../docs/PLAN.md) § 8, day 6).

## Usage

```typescript
import { SanaGuard } from '@sana-guard/sdk';

const guard = new SanaGuard({
  nearNetwork: 'testnet',
  guardContract: 'guard.djume.testnet',
  agentKey: agentKeyPair,
});

const vaultAddress = await guard.deriveVaultAddress(ownerPublicKey, vaultId);

const message = guard.buildTransfer({
  from: vaultAddress,
  to: recipientPublicKey,
  lamports: 1_000_000,
});

const signature = await guard.requestSign(vaultId, message, requestId);
const txId = await guard.assembleAndSend(signature, message);
```

## Dependencies

- `near-api-js` ^7.0.0 or `near-kit` ^0.20.0
- `@solana/kit` ^8.0.0
- `bs58`
