# Sana Guard — hackathon form (paste-ready)

Copy each block into the NEAR Hackathon form. Track: **AI Security & Defense**. Due **14 Nov 2026, 23:59 WIB**. Replace angle-bracket placeholders only.

---

## Project name

Sana Guard

## Tagline

Policy-enforced agent wallets: a NEAR contract is the only signer for an AI agent's Solana funds.

## Track

AI Security & Defense

## Short description

Sana Guard is a policy-enforced agent wallet. A NEAR contract holds per-vault policy and uses NEAR Chain Signatures (MPC, Ed25519) to sign Solana transactions for AI agents only when they pass that policy: per-tx limits, a rolling 24h cap, recipient and program allowlists, expiry, idempotency, priority-fee caps, and a kill switch. Owners log in with Privy. A relay pays NEAR gas. Agents never hold the Solana key.

## Long description

AI agents that hold a hot Solana key can be drained by a leaked key or a prompt injection. Prompt-level "don't send more than X" is not enforcement.

Sana Guard removes the hot key. Each vault's Solana address is an MPC-derived Ed25519 key (`vault/<owner>/<id>`, predecessor `guard.djume.testnet`, domain 1). The only way to sign is `request_sign` on the guard contract. The contract parses the Solana message (legacy / v0, no address lookup tables) and fails closed with stable `SG_E###` codes before it pays 1 yocto to `v1.signer-prod.testnet`.

Policy is owner-defined and on-chain: per-mint per-tx limits, rolling 24-hour caps (hourly buckets), recipient and program allowlists, memo length, compute-unit price and optional total priority-fee caps, expiry, and a pause kill switch. Tightening is immediate; loosening waits `loosen_delay_ns`. Spend is reserved when a signature is issued. Reusing a `req_id` or the same message hash in 24 hours is rejected.

Owners authenticate with Privy embedded Solana wallets and sign human-readable `SANA-GUARD-ADMIN-v1` messages. A Hono + SQLite relay on Railway verifies the signature and submits `owner_action` (it cannot call `request_sign`). Agents use `@sana-guard/sdk` or the MCP server (`sana_guard_transfer_sol`, dry-run `sana_guard_check_transfer`, no admin tools). The dashboard at https://guard.sana.bot includes an Attack lab that sends policy-violating messages and surfaces **Blocked by guard** plus the contract code (for example `SG_E062_PER_TX_LIMIT_EXCEEDED`).

This submission is NEAR **testnet** and Solana **devnet** only. The hosted demo caps relay-paid creates at 10 vaults total, one vault per owner, three agents per vault, and 0.25 NEAR gas funding per agent. Do not use it with mainnet funds. Mainnet `guard.djume.near` is a later, approval-gated milestone.

## Why this track

AI Security & Defense is about agents that cannot be socially engineered into moving money. Sana Guard puts the policy in a NEAR contract the agent cannot edit. A leaked function-call key, a jailbroken tool call, or a malicious `sign_transaction` still hits allowlists, caps, idempotency, and the kill switch. The Attack lab is the demo of that claim: the same agent path, a bad tx, a visible reject code, no signature.

## NEAR technology used

- **Smart contract** on NEAR testnet: `guard.djume.testnet` (Rust, near-sdk 5.30, `version()` `0.1.0` / `9cb56bd5c761`)
- **NEAR Chain Signatures (MPC)**: `v1.signer-prod.testnet`, Frost Ed25519, `domain_id` 1, `payload_v2: Eddsa`, contract-paid 1 yocto
- **Function-call keys** on `<agent>.guard.djume.testnet` (method `request_sign` only)
- **`env::ed25519_verify`** for owner admin messages (Privy Solana wallet)
- **NEP-297** events (`sana_guard`)
- **near-api-js** in the SDK, MCP server, and relay
- Testnet accounts: `guard.djume.testnet`, `relay.djume.testnet`, `agent1.guard.djume.testnet`

## Links

| Field | Value |
| --- | --- |
| Live demo | https://guard.sana.bot |
| Vault 0 | https://guard.sana.bot/vaults/0 |
| Source | https://github.com/0xjume/sana-guard |
| Contract explorer | https://testnet.nearblocks.io/address/guard.djume.testnet |
| Sample signed Solana tx (devnet) | https://explorer.solana.com/tx/5w6yEG25bVffWMFERM4LF9oJVmtGutZqbC1WrA7bx43UWvEJcCeFueU9xDaYkNrLuRrVkySSjQZcm5FsuBY1CX1r?cluster=devnet |
| Demo video | `<VIDEO_URL>` |
| Demo script | https://github.com/0xjume/sana-guard/blob/main/docs/DEMO.md |
| Pitch / README | https://github.com/0xjume/sana-guard/blob/main/README.md |
| X / social post | `<X_POST_URL>` |
| Slide deck | `<DECK_URL>` |

## How to judge (60 seconds)

1. Open https://guard.sana.bot/vaults/0 — policy is on-chain (0.05 / 0.1 SOL, one recipient).
2. Watch or run the Attack lab **Over per-tx limit** → **Blocked by guard** / `SG_E062_PER_TX_LIMIT_EXCEEDED` (needs the deployment Attack lab token).
3. Confirm the sample MPC-signed devnet transfer above (vault `Fkk515…` → `DeF8…`).
4. Optional: Privy login as the vault owner and use **Kill switch** → **Pause vault**.

## Team

| Name | Role | Handle |
| --- | --- | --- |
| Jume | Design, contract, SDK, relay, dashboard, deploy | GitHub [0xjume](https://github.com/0xjume) |

`<TEAM_EMAIL>` · `<TEAM_TELEGRAM>`

Solo submission unless additional members are added here before submit.

## License

MIT. Copyright (c) 2026 Jume / 0xjume.

## What this is not

- Not a Solana on-chain program. Policy is on NEAR; Solana sees a normal signed tx.
- Not mainnet. No `guard.djume.near` in this submission.
- Not a copy of private Sana product code. This repo is a public, from-scratch monorepo.
- The relay is not a signer and is not in the agent `request_sign` path.

## Character counts (if the form truncates)

Short description above is ~520 characters. If the form wants ~280:

> Policy-enforced agent wallet: a NEAR contract uses Chain Signatures to sign Solana txs for AI agents only after on-chain caps, allowlists, expiry, and a kill switch. Privy for owners. Testnet/devnet live at guard.sana.bot.
