# Day 1 Spike: MPC Signing with Function-Call Key

This script verifies the riskiest assumptions from PLAN.md § 9:

- **S1**: A function-call key can initiate a contract-to-MPC call where the contract attaches 1 yocto
- **S2**: MPC latency vs Solana blockhash expiry (about 60s)
- **S3**: Gas consumption for the full sign flow

## Setup

```bash
cd scripts/spikes/day1
pnpm install
cp .env.example .env
```

Fill in `.env`:

```bash
NEAR_NETWORK=testnet
MPC_CONTRACT=v1.signer-prod.testnet
GUARD_CONTRACT=guard.djume.testnet
NEAR_PRIVATE_KEY=ed25519:...  # For submitting the request
VAULT_PATH=vault/DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB/0
```

## Run

```bash
pnpm start
```

## Output

- Derived vault address (Ed25519 public key)
- Built Solana devnet transfer message (legacy format)
- Hex-encoded message ready for MPC signing
- Instructions to call MPC via the spike contract

## Next steps

1. Fund the vault address on Solana devnet
2. Deploy a minimal spike contract that calls MPC
3. Measure latency and gas
4. Broadcast the signed transaction

Results should be documented in `docs/spikes.md`.
