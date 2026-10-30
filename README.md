# Sana Guard

**Policy-enforced AI agent wallets via NEAR Chain Signatures**

A NEAR smart contract that acts as the *only* signer for AI agents' Solana wallets. It uses NEAR's MPC network (Chain Signatures, Ed25519) to sign Solana transactions **only if the parsed transaction passes the owner's policy**. Leaking an agent key or prompt-injecting the agent cannot bypass the caps.

Built for the NEAR Hackathon (AI Security & Defense track), Nov 1–15, 2026.

## Architecture

```
┌─────────────────┐
│  Owner          │
│  (Dashboard)    │◄──────┐
│  Privy wallet   │       │
└────────┬────────┘       │
         │                │
         │ signMessage    │ events
         ▼                │
┌─────────────────┐       │
│  Relay          │       │
│  (pays gas)     │       │
└────────┬────────┘       │
         │                │
         │ owner_action   │
         ▼                │
┌─────────────────────────┴────────────┐
│  guard.djume.testnet                 │
│  (NEAR smart contract)               │
│  • Parse Solana messages             │
│  • Enforce policy                    │
│  • Account for spend                 │
└────────┬─────────────────────────────┘
         │
         │ sign (1 yocto, 50 Tgas)
         ▼
┌──────────────────────────────────────┐
│  v1.signer-prod.testnet              │
│  (NEAR MPC / Chain Signatures)       │
│  Frost Ed25519, domain_id 1          │
└────────┬─────────────────────────────┘
         │
         │ {scheme:Ed25519, signature}
         ▼
     (callback)
         │
         ▼
┌──────────────────┐      ┌─────────────┐
│  SDK             │─────▶│  Solana     │
│  (assemble tx)   │      │  devnet/    │
└──────────────────┘      │  mainnet    │
         ▲                └─────────────┘
         │
┌────────┴────────┐
│  AI Agent       │
│  (MCP client)   │
└─────────────────┘
```

## Key Features

- **Policy enforcement on-chain**: recipient allowlists, per-tx limits, rolling 24h caps, program allowlists, gas limits
- **Solana message parser** (in-contract, no dependencies): supports SystemProgram transfer, SPL Token transfer/transferChecked, ATA creation, ComputeBudget, Memo; rejects everything else
- **Kill switch**: instant vault pause by the owner
- **Admin controls**: owner-signed messages verified via `ed25519_verify`, with nonce and expiry
- **Spend reservation**: treats a signature as money out, preventing double-counting
- **Agent isolation**: each agent gets a subaccount with one function-call key

## Monorepo Structure

```
sana-guard/
├── contracts/guard/          # NEAR smart contract (Rust, near-sdk 5.x)
├── packages/sdk/             # TypeScript SDK (near-api-js, @solana/kit)
├── apps/
│   ├── relay/                # Node.js relay (pays gas for owner actions)
│   ├── dashboard/            # Next.js dashboard (Privy)
│   └── mcp/                  # MCP server for AI agents
├── skills/sana-guard/        # MCP skill documentation
├── scripts/spikes/           # Research scripts
├── docs/                     # PLAN.md, NOTES.md
└── .github/workflows/        # CI (fmt, clippy, test, build)
```

## Quick Start

### Prerequisites

- Rust 1.80+ with `wasm32-unknown-unknown` target
- Node.js 20+
- pnpm 9+
- cargo-near 0.22+

### Build

```bash
# Install dependencies
pnpm install

# Build contract
cd contracts/guard
cargo near build --release

# Run tests
cargo test
```

### Deploy (testnet)

```bash
# Deploy to a testnet account
cargo near deploy guard.djume.testnet --no-docker
```

## Development

- **Contract tests**: `cd contracts/guard && cargo test`
- **Lint**: `pnpm lint` (TypeScript), `cargo clippy` (Rust)
- **Format**: `pnpm format`, `cargo fmt`

## Documentation

- [PLAN.md](./docs/PLAN.md) — Full design, architecture, threat model, milestones
- [NOTES.md](./docs/NOTES.md) — Research notes, verified facts, citations

## Security

This is hackathon code. **Do not use with real funds** without a full security audit. See [PLAN.md § 7](./docs/PLAN.md#7-threat-model-and-audit-checklist) for the threat model and audit checklist.

## License

MIT License — see [LICENSE](./LICENSE)

Copyright (c) 2026 Jume / 0xjume
