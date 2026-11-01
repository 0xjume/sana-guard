# Sana Guard Status

**Updated:** October 31, 2026 (after [#15](https://github.com/0xjume/sana-guard/pull/15), [#16](https://github.com/0xjume/sana-guard/pull/16), [#17](https://github.com/0xjume/sana-guard/pull/17))

Policy-enforced AI agent wallets: a NEAR contract signs Solana transactions through NEAR Chain Signatures only when they pass the owner's policy. Design and day-by-day plan: [docs/PLAN.md](./docs/PLAN.md).

## Components

| Path | State | Checks in CI |
|---|---|---|
| `contracts/guard` | Implemented. Exercised in testnet E2E runs (fixes in #2, #3). Memo v1 / short_vec / priority-fee total in #15–#17 | fmt, clippy `-D warnings`, `cargo test`, WASM build |
| `packages/sdk` | Implemented (#6). Compact-u16 encode/decode matches Solana short_vec (#13, #15, #16) | lint, typecheck, build, jest |
| `apps/relay` | Implemented (#5, #9); Railway deploy config included | lint, typecheck, vitest, Docker image health check |
| `apps/mcp` | Implemented (#11). Local memo pre-check (#16); idempotency-key reuse and blockhash pre-check (#17) | lint, typecheck, vitest, build |
| `apps/dashboard` | Owner console (Privy + relay + live NEAR views) | lint, typecheck, vitest, Next.js build |

Prettier (`pnpm format:check`) runs over all TypeScript, JavaScript and JSON. Markdown is excluded.

## Contract

- Solana message parser (legacy and v0, no address lookup tables) for System transfer, SPL Token transfer/transferChecked, ATA create-idempotent, ComputeBudget and Memo v1 (`Memo1Uhk…`; the `MEMO_V2_PROGRAM` constant holds this v1 address). Rejections use stable codes `SG_E001`–`SG_E078`.
- Policy: per-vault program allowlist, recipient and mint allowlists, per-tx limits, rolling 24h caps, per-price and total priority fee caps (`SG_E078`), expiry, kill switches, delayed loosening.
- Priority fees count price-only ComputeBudget setPrice × CU limit (or the default CU-per-ix), not the 5000-lamport base signature fee (#17).
- Spend is reserved at sign time and released exactly once on failure or by the owner (#4).
- Owner actions are ed25519-signed messages with nonce and expiry; vault addresses are verified on-chain against MPC `derived_public_key` (#3).
- Deposits: one excess refund per action, and callback refunds go to the original caller (#7).

## Next (per PLAN.md §9)

1. Self-audit against PLAN.md §7, longer fuzzing, gas profiling.
2. End-to-end owner flows on the deployed dashboard once a Privy app ID and relay CORS origin are set.

## Security

Hackathon code. Do not use with real funds without an audit. Threat model: [PLAN.md §7](./docs/PLAN.md#7-threat-model-and-audit-checklist).
