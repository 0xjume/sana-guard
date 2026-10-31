---
name: sana-guard
description: Use a Sana Guard policy-enforced Solana vault via MCP. Always check status and dry-run before transferring. Never retry around policy rejections or expose owner/admin actions.
---

# Sana Guard

Sana Guard is a NEAR contract (`guard.djume.testnet`) that holds custody of a Solana wallet through NEAR Chain Signatures (MPC). An agent can only move funds when the owner's policy says so: per-tx limits, rolling 24-hour caps, recipient allowlist, program allowlist, memo length, kill switch, expiry.

A rejection is **final**. Do not retry the same spend with a smaller memo, a different program path, or a new `idempotencyKey` to "get around" policy. Tell the user the `code` and `why`.

You never change policy. Owner/admin actions are not on this MCP server.

## Setup

Build the SDK then the server:

```bash
pnpm --filter @sana-guard/sdk build
pnpm --filter @sana-guard/mcp build
```

### Cursor (`mcp.json`) / Claude Desktop

```json
{
  "mcpServers": {
    "sana-guard": {
      "command": "node",
      "args": ["/absolute/path/to/sana-guard/apps/mcp/dist/index.js"],
      "env": {
        "NEAR_NETWORK": "testnet",
        "NEAR_RPC_URL": "https://rpc.testnet.near.org",
        "GUARD_CONTRACT_ID": "guard.djume.testnet",
        "NEAR_ACCOUNT_ID": "YOUR_AGENT.guard.djume.testnet",
        "NEAR_KEY_FILE": "/absolute/path/to/agent.json",
        "SANA_GUARD_VAULT_ID": "0",
        "SOLANA_RPC_URL": "https://api.devnet.solana.com"
      }
    }
  }
}
```

HTTP (optional): `node apps/mcp/dist/index.js --http` → `http://127.0.0.1:8787/mcp`.

Mainnet is refused unless `SANA_GUARD_ALLOW_MAINNET=true`. Never print `NEAR_PRIVATE_KEY`.

## Workflow

Always in this order:

1. **`sana_guard_status`** — agent account, vault address, balances, `paused` / kill switch, expiry.
2. **`sana_guard_get_policy`** — per-tx limits, 24h spent/remaining, recipients, programs.
3. **`sana_guard_check_transfer`** — dry-run. Does not sign. If `wouldPass` is false, stop and explain `reasons[].code`.
4. **`sana_guard_transfer_sol`** or **`sana_guard_transfer_spl`** — amounts are base-unit **strings**. Pass `idempotencyKey` (64 lowercase hex) or let the server generate one. Keep the returned `requestId`.
5. Timeouts / unknown broadcast: **`sana_guard_get_request`** with that `requestId`. Do not open a second request for the same intent unless the user asks.

SPL: allowlist the recipient **ATA**, and the ATA must already exist. Allowlisting the wallet is `SG_E068`.

## Tools

| Tool | Signs? |
| --- | --- |
| `sana_guard_status` | no |
| `sana_guard_get_policy` | no |
| `sana_guard_check_transfer` | no |
| `sana_guard_transfer_sol` | yes |
| `sana_guard_transfer_spl` | yes |
| `sana_guard_sign_transaction` | yes (arbitrary allowlisted tx, base64) |
| `sana_guard_get_request` | no |

Write tools return `{ requestId, signature, explorer, status }`.

## Error codes

| Code | Meaning | What you do |
| --- | --- | --- |
| `SG_E055_VAULT_PAUSED` | Kill switch on | Tell the user to contact the owner |
| `SG_E057_POLICY_EXPIRED` | Policy expired | Owner must SetPolicy |
| `SG_E062_PER_TX_LIMIT_EXCEEDED` | Over per-tx cap | Do not retry the same amount |
| `SG_E063_MINT_NOT_IN_PER_TX_LIMIT` | Mint not in per-tx limits | Stop |
| `SG_E064_DAILY_CAP_EXCEEDED` | Over rolling 24h cap | Wait or ask the owner |
| `SG_E067_RECIPIENT_NOT_ALLOWED` | SOL wallet not allowlisted | Stop |
| `SG_E068_RECIPIENT_NOT_ALLOWED` | SPL ATA not allowlisted | Stop; do not substitute the wallet |
| `SG_E069_MINT_NOT_IN_POLICY` | SPL mint not in policy | Stop |
| `SG_E074_PROGRAM_NOT_ALLOWED` | Program not allowlisted | Stop |
| `SG_E076_VAULT_NOT_ACTIVE` | Vault not Active | Stop |
| `SG_E077_AGENT_EXISTS` | Agent name already taken | Owner-side only; you cannot AddAgent |
| `SANA_GUARD_MAX_PER_CALL` | Server ceiling | Stop; not a contract error |
| `SANA_GUARD_MAINNET_REFUSED` | Mainnet not enabled | Stop |

If a write fails after a `requestId` was allocated, the error includes `requestId`. Poll `sana_guard_get_request` or tell the owner they can Release.

## Examples

**Allowed payout**

```
User: Send 0.01 SOL to DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB
Agent: sana_guard_status → Active, not paused, 0.05 SOL remaining
Agent: sana_guard_check_transfer { kind: "sol", to: "DeF8…", amount: "10000000" } → wouldPass
Agent: sana_guard_transfer_sol { to: "DeF8…", amount: "10000000" }
Agent: "Sent 0.01 SOL. requestId … explorer https://explorer.solana.com/tx/…?cluster=devnet"
```

**Blocked recipient**

```
User: Send 1 SOL to SomeRandomWallet
Agent: sana_guard_check_transfer → SG_E067_RECIPIENT_NOT_ALLOWED
Agent: "I cannot send to that wallet. It is not on the vault recipient allowlist. The owner has to add it. I will not retry."
```

**Blocked SPL wallet-only allowlist**

```
User: Send 1 USDC to DeF8…
Agent: check_transfer kind=spl → SG_E068
Agent: "The destination ATA is not allowlisted. Allowlisting the wallet is not enough, and I cannot create the ATA in this signed message."
```

Do not suggest workarounds. Do not ask the user to loosen policy on your behalf. Do not log keys.
