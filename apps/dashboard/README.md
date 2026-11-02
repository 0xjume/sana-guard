# Sana Guard Dashboard

Owner console for [Sana Guard](https://github.com/0xjume/sana-guard): a NEAR contract that is the only signer for AI agents' Solana wallets.

The dashboard authenticates owners with a **Privy embedded Solana wallet**. Owner actions are signed in the browser with that Solana key and submitted through **this app's** `POST /api/owner-action`, which forwards to the relay (`POST /v1/admin`) and attaches the server-only invite token. Vault reads go to NEAR RPC (`owner_vault_count`, `get_vault`, `get_policy` via `get_vault`, `get_spend_24h`, `get_recipients`, `list_vaults`, `supported_programs`, `owner_nonce`) using the shared SDK parsers.

## Hosted demo onboarding

Judges can self-onboard without being allowlisted:

1. **Sign in with Privy** (email or a Solana wallet). Privy creates an embedded Solana wallet if you do not already have one.
2. **Create one vault.** The relay pays ~0.5 NEAR storage + gas. The dashboard enforces `MAX_VAULTS_PER_OWNER` (default 1) via the contract `owner_vault_count` view and a global `MAX_RELAY_VAULTS_TOTAL` cap (default 10) from `list_vaults`. The UI reads that owner limit from `GET /api/owner-action` so it stays in sync with the server. Create vault is hidden/disabled with `One vault per owner on the hosted demo` once you already own one.
3. **Set policy** (tighten immediately; loosening is delayed).
4. **Add an agent key.**
5. **Fund the vault Solana address** shown after create (QR + explorer link).

`OWNER_ALLOWLIST` is optional. If set, only listed wallets can act. If unset, any authenticated Privy user with a linked Solana wallet may act on vaults they own. `INVITE_TOKEN` is still attached server-side so the public relay's CreateVault gate stays closed to anonymous callers.

**Relay spend cap:** `VaultView` / `list_vaults` do not carry a creation timestamp or block, so the dashboard cannot count “vaults created in the last 24h.” It uses **`MAX_RELAY_VAULTS_TOTAL` (default 10)** against the on-chain vault count instead of `MAX_RELAY_VAULTS_PER_DAY`. Exceeded creates return `DASH_RELAY_VAULT_CAP`. Per-owner overflow returns `DASH_VAULT_LIMIT`. A broken `owner_vault_count` / `list_vaults` value fails closed (`503`, generic `Vault limit check unavailable, try again`).

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
- Owner actions via the SDK + `/api/owner-action` + relay: create vault, set policy, add/remove agent, add/remove recipient, register token account, pause/unpause. The route verifies a Privy access token, requires a linked Solana wallet, and rate-limits per owner. `OWNER_ALLOWLIST` is optional. CreateVault is capped per owner and by a global hosted-demo vault total.
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
| `PRIVY_APP_SECRET` | server | Required to enable `/api/owner-action`. Verifies Privy access tokens (JWKS or `PRIVY_VERIFICATION_KEY`) and loads linked wallets |
| `PRIVY_VERIFICATION_KEY` | server | Optional ES256 PEM so JWT verify can skip a JWKS fetch |
| `OWNER_ALLOWLIST` | server | Optional comma-separated owner pubkeys. If set, only listed wallets may act. If unset, any authenticated Privy Solana wallet may act |
| `INVITE_TOKEN` | server | Relay invite gate. Attached after Privy auth. Optional; does not require `OWNER_ALLOWLIST`. Never `NEXT_PUBLIC_` |
| `MAX_VAULTS_PER_OWNER` | server | CreateVault per-owner cap via `owner_vault_count`. Default `1` |
| `MAX_RELAY_VAULTS_TOTAL` | server | CreateVault global cap via `list_vaults` count. Default `10`. Used because vaults have no created-at field |
| `DEMO_AGENT_ACCOUNT_ID` | server | Attack Lab agent account |
| `DEMO_AGENT_PRIVATE_KEY` | server | Attack Lab `ed25519:` key. Never commit |
| `DEMO_AGENT_VAULT_ID` | server | Pinned Attack Lab vault. Required to enable |
| `ATTACK_LAB_TOKEN` | server | Required header for Attack Lab POST. Disabled if unset |

`GET /api/owner-action` returns the public `{ maxVaultsPerOwner, maxRelayVaultsTotal }` so the create form uses the server `MAX_VAULTS_PER_OWNER` instead of a hard-coded 1. `POST /api/owner-action` is disabled (503) until `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET` are set. `OWNER_ALLOWLIST` is optional: when unset, any authenticated Privy user with a linked Solana wallet may act; when set, only listed wallets may. CreateVault additionally checks `owner_vault_count` (`DASH_VAULT_LIMIT`) and the listed vault total (`DASH_RELAY_VAULT_CAP`). The route requires `Authorization: Bearer <Privy access token>` and the payload owner to be a **Solana** wallet linked to that user (`chain_type === solana`). Non-create actions still rely on the contract's owner checks. On Vercel (`VERCEL=1`), rate-limit IPs come from `x-vercel-forwarded-for` / `x-real-ip`. Off Vercel those headers are ignored and IPs share a `local` bucket; per-owner limits still apply. Never trust client `x-forwarded-for`.

## Vercel deploy

1. Import the `sana-guard` GitHub repo into Vercel.
2. Set **Root Directory** to `apps/dashboard`.
3. Framework preset: Next.js. Install/build from the monorepo (Vercel should detect pnpm). If the build cannot see the workspace SDK, set:
   - Install command: `cd ../.. && pnpm install --frozen-lockfile`
   - Build command: `pnpm --filter @sana-guard/sdk build && pnpm --filter @sana-guard/dashboard build`
4. Add the env vars above (at least `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET` for owner actions, plus the `NEXT_PUBLIC_*` network defaults). Put `INVITE_TOKEN` (so the public relay accepts CreateVault after Privy auth), optional `OWNER_ALLOWLIST`, vault-cap overrides, and Attack Lab secrets on the server only.
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
