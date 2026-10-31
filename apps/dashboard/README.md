# Sana Guard Dashboard

Owner console for [Sana Guard](https://github.com/0xjume/sana-guard): a NEAR contract that is the only signer for AI agents' Solana wallets.

The dashboard authenticates owners with a **Privy embedded Solana wallet**. Owner actions are signed in the browser with that Solana key and submitted through the relay (`POST /v1/admin`), which pays NEAR gas. Vault reads go to NEAR RPC (`owner_vault_count`, `get_vault`, `get_policy` via `get_vault`, `get_spend_24h`, `get_recipients`, `list_vaults`, `supported_programs`, `owner_nonce`) using the shared SDK parsers.

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
- Owner actions via the SDK + relay: create vault, set policy, add/remove agent, add/remove recipient, register token account, pause/unpause
- Policy editor shows whether a change is an **immediate tightening** or a **delayed loosen**
- Cancel pending loosen by re-submitting the current policy (the contract treats an equal policy as stricter and clears `pending_loosen`). There is no dedicated cancel method.
- Activity feed from NearBlocks testnet account history (degrades if the indexer is down)
- Attack Lab: server-only `request_sign` against policy-violating messages

## Attack Lab (agent keys stay on the server)

Attack Lab is **not** implemented in the relay. It is `POST /api/attack-lab` in this Next.js app.

- Disabled unless **both** `DEMO_AGENT_ACCOUNT_ID` and `DEMO_AGENT_PRIVATE_KEY` are set on the server
- Those values are never prefixed with `NEXT_PUBLIC_`
- The route builds violating Solana messages with the SDK (`over per-tx`, `non-allowlisted recipient`, `disallowed program`, `oversized priority fee`, `replay idempotency key`) and calls `request_sign` as the demo agent
- Replay: `SG_E059` only fires after a request id was accepted. A violating first attempt does not store the id, so a second attempt fails at policy again. That is expected and does not spend vault funds.

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

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | client | Privy app. Missing → config screen |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | client | Optional Privy client ID |
| `NEXT_PUBLIC_NEAR_NETWORK` | client | `testnet` (default) |
| `NEXT_PUBLIC_GUARD_CONTRACT` | client | `guard.djume.testnet` |
| `NEXT_PUBLIC_NEAR_RPC` | client | `https://rpc.testnet.near.org` |
| `NEXT_PUBLIC_MPC_CONTRACT` | client | `v1.signer-prod.testnet` |
| `NEXT_PUBLIC_MPC_DOMAIN_ID` | client | `1` |
| `NEXT_PUBLIC_RELAY_URL` | client | `https://relay-production-665a.up.railway.app` |
| `NEXT_PUBLIC_SOLANA_RPC` | client | `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_INVITE_TOKEN` | client | Optional convenience for the relay invite gate |
| `DEMO_AGENT_ACCOUNT_ID` | server | Attack Lab agent account |
| `DEMO_AGENT_PRIVATE_KEY` | server | Attack Lab `ed25519:` key. Never commit |
| `DEMO_AGENT_VAULT_ID` | server | Optional default vault id |

CreateVault and AddAgent on the public relay require `X-Invite-Token` (or an owner allowlist). Paste the token in the header **Invite token** field; it is stored only in `localStorage`.

## Vercel deploy

1. Import the `sana-guard` GitHub repo into Vercel.
2. Set **Root Directory** to `apps/dashboard`.
3. Framework preset: Next.js. Install/build from the monorepo (Vercel should detect pnpm). If the build cannot see the workspace SDK, set:
   - Install command: `cd ../.. && pnpm install --frozen-lockfile`
   - Build command: `pnpm --filter @sana-guard/sdk build && pnpm --filter @sana-guard/dashboard build`
4. Add the env vars above (at least `NEXT_PUBLIC_PRIVY_APP_ID`, plus the `NEXT_PUBLIC_*` network defaults).
5. After the first preview/production URL exists, add that origin to the relay `CORS_ORIGINS` (comma-separated) and **redeploy the Railway relay**. Unset `CORS_ORIGINS` means the browser cannot call `/v1/admin`.
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
