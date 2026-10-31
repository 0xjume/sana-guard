# Sana Guard Status

**Updated:** October 31, 2026 (after [#13](https://github.com/0xjume/sana-guard/pull/13))

Policy-enforced AI agent wallets: a NEAR contract signs Solana transactions through NEAR Chain Signatures only when they pass the owner's policy. Design and day-by-day plan: [docs/PLAN.md](./docs/PLAN.md).

## Components

| Path | State | Checks in CI |
|---|---|---|
| `contracts/guard` | Implemented. Exercised in testnet E2E runs (fixes in #2, #3) | fmt, clippy `-D warnings`, `cargo test`, WASM build |
| `packages/sdk` | Implemented (#6) | lint, typecheck, build, jest |
| `apps/relay` | Implemented (#5, #9); Railway deploy config included | lint, typecheck, vitest, Docker image health check |
| `apps/mcp` | Implemented (#11): agent-only tools, testnet/devnet by default | lint, typecheck, vitest, build |
| `apps/dashboard` | Placeholder (README only) | — |

Prettier (`pnpm format:check`) runs over all TypeScript, JavaScript and JSON. Markdown is excluded.

## Contract

- Solana message parser (legacy and v0, no address lookup tables) for System transfer, SPL Token transfer/transferChecked, ATA create-idempotent, ComputeBudget and Memo. Rejections use stable codes `SG_E001`–`SG_E077`.
- Policy: per-vault program allowlist, recipient and mint allowlists, per-tx limits, rolling 24h caps, priority fee caps, expiry, kill switches, delayed loosening.
- Spend is reserved at sign time and released exactly once on failure or by the owner (#4).
- Owner actions are ed25519-signed messages with nonce and expiry; vault addresses are verified on-chain against MPC `derived_public_key` (#3).
- Deposits: one excess refund per action, and callback refunds go to the original caller (#7).

## Next (per PLAN.md §9)

1. `apps/dashboard`: owner dashboard with Privy login, policy editor, kill switch, attack lab.
2. Self-audit against PLAN.md §7, longer fuzzing, gas profiling.

## Security

Hackathon code. Do not use with real funds without an audit. Threat model: [PLAN.md §7](./docs/PLAN.md#7-threat-model-and-audit-checklist).
