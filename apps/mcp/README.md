# Sana Guard MCP Server

MCP server so AI agents can use a [Sana Guard](https://github.com/0xjume/sana-guard) vault without ever seeing owner/admin actions or the agent's private key.

It talks to the chain only through `@sana-guard/sdk`. Tested against `guard.djume.testnet` and Solana devnet.

## Tools

| Tool | Writes? | Purpose |
| --- | --- | --- |
| `sana_guard_status` | no | Agent account, vault address, SOL/token balances, kill switch, expiry |
| `sana_guard_get_policy` | no | Limits, 24h spent/remaining, recipient and program allowlists |
| `sana_guard_check_transfer` | no | Dry-run policy pre-check. Never signs. |
| `sana_guard_transfer_sol` | yes | SystemProgram transfer |
| `sana_guard_transfer_spl` | yes | SPL `transferChecked` to an existing ATA |
| `sana_guard_sign_transaction` | yes | Sign an allowlisted serialized Solana tx/message (base64) |
| `sana_guard_get_request` | no | `get_request` by 64-hex `requestId` |

Write tools take an optional `idempotencyKey` (64 lowercase hex; generated if omitted) and return `requestId`, Solana `signature`, explorer URL, and broadcast `status`. Amounts are always integer strings.

Owner/admin actions (CreateVault, SetPolicy, AddAgent, …) are **not** exposed.

## Safety

- Default networks: NEAR **testnet**, Solana **devnet**.
- Mainnet is refused unless `SANA_GUARD_ALLOW_MAINNET=true`.
- Optional `SANA_GUARD_MAX_LAMPORTS_PER_CALL` / `SANA_GUARD_MAX_TOKEN_AMOUNT_PER_CALL`.
- Private keys are read from env or a key file and never logged or returned.
- Contract codes (`SG_E062`, `SG_E068`, `SG_E077`, …) are mapped to structured `{ code, message, why, requestId? }` errors.

## Setup

```bash
# from repo root
pnpm install
pnpm --filter @sana-guard/sdk build
pnpm --filter @sana-guard/mcp build
```

Copy [`.env.example`](./.env.example) and fill in the agent function-call key.

```bash
export NEAR_NETWORK=testnet
export NEAR_RPC_URL=https://rpc.testnet.near.org
export GUARD_CONTRACT_ID=guard.djume.testnet
export NEAR_ACCOUNT_ID=agent1.guard.djume.testnet
export NEAR_PRIVATE_KEY=ed25519:...
export SANA_GUARD_VAULT_ID=0
export SOLANA_RPC_URL=https://api.devnet.solana.com
```

### stdio (default)

```bash
pnpm --filter @sana-guard/mcp start
# or
node apps/mcp/dist/index.js
```

### Streamable HTTP

```bash
pnpm --filter @sana-guard/mcp start:http
# MCP_TRANSPORT=http MCP_HTTP_PORT=8787 node apps/mcp/dist/index.js --http
```

Listens on `http://127.0.0.1:8787/mcp`.

## Cursor / Claude Desktop

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
        "NEAR_ACCOUNT_ID": "agent1.guard.djume.testnet",
        "NEAR_PRIVATE_KEY": "ed25519:...",
        "SANA_GUARD_VAULT_ID": "0",
        "SOLANA_RPC_URL": "https://api.devnet.solana.com"
      }
    }
  }
}
```

Do not put the private key in a committed file. Prefer `NEAR_KEY_FILE` pointing at a local Near credentials JSON.

Agent skill: [`skills/sana-guard/SKILL.md`](../../skills/sana-guard/SKILL.md).

## Tests

```bash
pnpm --filter @sana-guard/mcp test
pnpm --filter @sana-guard/mcp lint
pnpm --filter @sana-guard/mcp typecheck
```

Opt-in live read against testnet/devnet (never run in CI):

```bash
SANA_GUARD_LIVE=1 pnpm --filter @sana-guard/mcp test:live
```

## Workflow for agents

1. `sana_guard_status`
2. `sana_guard_get_policy`
3. `sana_guard_check_transfer`
4. `sana_guard_transfer_sol` / `sana_guard_transfer_spl`
5. On rejection, explain the `code` and **do not retry around policy**. Poll `sana_guard_get_request` only for timeouts.
