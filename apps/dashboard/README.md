# Sana Guard Dashboard

Owner console for [Sana Guard](https://github.com/0xjume/sana-guard): a NEAR contract that is the only signer for AI agents' Solana wallets.

The dashboard authenticates owners with a **Privy embedded Solana wallet**. Owner actions are signed in the browser with that Solana key and submitted through **this app's** `POST /api/owner-action`, which forwards to the relay (`POST /v1/admin`) and attaches the server-only invite token. Vault reads go to NEAR RPC (`owner_vault_count`, `get_vault`, `get_policy` via `get_vault`, `get_spend_24h`, `get_recipients`, `list_vaults`, `supported_programs`, `owner_nonce`) using the shared SDK parsers.

## What works without a Privy app ID

The app **builds and renders** if `NEXT_PUBLIC_PRIVY_APP_ID` is unset. You get:

- A clear **missing configuration** panel
- Live read-only status for `guard.djume.testnet` (supported programs + visible vault count)
- Vault detail URLs still load public views (address, policy, agents, 24h spend, Solana balance)

Login, create vault, policy edits, agents, and the kill switch stay disabled until Privy is configured.

## Features

- Privy login (Solana embedded wallets + optional external Solana wallets)
- Vault list for the signed-in owner
- Vault detail: address + QR, SOL balance (devnet RPC), policy, pending loosen countdown, agents, recipients
- Owner actions via the SDK + `/api/owner-action` + relay: create vault, set policy, add/remove agent, add/remove recipient, register token account, pause/unpause
- Policy editor preserves SPL / unedited fields and shows whether a change is an **immediate tightening** or a **delayed loosen**
- Cancel pending loosen by re-submitting the current policy (the contract treats an equal policy as stricter and clears `pending_loosen`). There is no dedicated cancel method.
- Activity feed from NearBlocks testnet account history (empty indexer responses are **no history source**, not a silent empty vault)
- Attack Lab: server-only `request_sign` against policy-violating messages that a TS port of `policy.rs` has already rejected

## Attack Lab (agent keys stay on the server)

Attack Lab is **not** implemented in the relay. It is `POST /api/attack-lab` in this Next.js app.

- Disabled unless **all** of `DEMO_AGENT_ACCOUNT_ID`, `DEMO_AGENT_PRIVATE_KEY`, `DEMO_AGENT_VAULT_ID`, and `ATTACK_LAB_TOKEN` are set on the server
- Those values are never prefixed with `NEXT_PUBLIC_`
- POST requires `X-Attack-Lab-Token` (constant-time compare). Unset token disables the route.
- The client vault id is ignored. The route pins `DEMO_AGENT_VAULT_ID`.
- Simple in-memory rate limit (8 requests / 60s / client)
- Payloads: over per-tx, non-allowlisted recipient, disallowed program, oversized priority fee (`max_priority_fee * 1_000_000 + 1` micro-lamports). Replay / `SG_E059` is not offered — that code only fires after a request id was accepted.
- Each payload is evaluated against a TypeScript port of the contract rules before `request_sign` is called.

`GET /api/attack-lab` reports whether the demo agent is configured.

## Setup

From the repo root:

```bash
pnpm install
cd apps/dashboard
cp .env.example .env.local
# Set NEXT_PUBLIC_PRIVY_APP_ID for login
pnpm --filter @sana-guard/dashboard dev
```

Requires Node.js 20+.

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | client | Privy app. Missing → config screen |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | client | Optional Privy client ID |
| `NEXT_PUBLIC_NEAR_NETWORK` | client | `testnet` (default). `mainnet` is refused without explicit contract + RPC |
| `NEXT_PUBLIC_GUARD_CONTRACT` | client | `guard.djume.testnet` on testnet |
| `NEXT_PUBLIC_NEAR_RPC` | client | `https://rpc.testnet.near.org` on testnet |
| `NEXT_PUBLIC_MPC_CONTRACT` | client | `v1.signer-prod.testnet` |
| `NEXT_PUBLIC_MPC_DOMAIN_ID` | client | `1` |
| `NEXT_PUBLIC_RELAY_URL` | client | `https://relay-production-665a.up.railway.app` |
| `NEXT_PUBLIC_SOLANA_RPC` | client | `https://api.devnet.solana.com` |
| `INVITE_TOKEN` | server | Relay invite gate. Attached by `/api/owner-action`. Never `NEXT_PUBLIC_` |
| `DEMO_AGENT_ACCOUNT_ID` | server | Attack Lab agent account |
| `DEMO_AGENT_PRIVATE_KEY` | server | Attack Lab `ed25519:` key. Never commit |
| `DEMO_AGENT_VAULT_ID` | server | Pinned Attack Lab vault. Required to enable |
| `ATTACK_LAB_TOKEN` | server | Required header for Attack Lab POST. Disabled if unset |

CreateVault and AddAgent on the public relay require `X-Invite-Token` (or an owner allowlist). Set `INVITE_TOKEN` on the dashboard server. The alternative is to configure the relay so it does not require invite for this origin — prefer the server route so the token never ships in the client bundle.

## Vercel deploy

1. Import the `sana-guard` GitHub repo into Vercel.
2. Set **Root Directory** to `apps/dashboard`.
3. Framework preset: Next.js. Install/build from the monorepo (Vercel should detect pnpm). If the build cannot see the workspace SDK, set:
   - Install command: `cd ../.. && pnpm install --frozen-lockfile`
   - Build command: `pnpm --filter @sana-guard/sdk build && pnpm --filter @sana-guard/dashboard build`
4. Add the env vars above (at least `NEXT_PUBLIC_PRIVY_APP_ID`, plus the `NEXT_PUBLIC_*` network defaults). Put `INVITE_TOKEN` and Attack Lab secrets on the server only.
5. Owner actions no longer need the browser to call the relay directly. If you still expose other browser→relay calls, add the Vercel URL to relay `CORS_ORIGINS`.
6. In Privy, add the Vercel URL to allowed origins and enable Solana embedded wallets.

## Scripts

```bash
pnpm --filter @sana-guard/dashboard lint
pnpm --filter @sana-guard/dashboard typecheck
pnpm --filter @sana-guard/dashboard test
pnpm --filter @sana-guard/dashboard build
```

## License

MIT
