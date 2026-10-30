# Sana Guard MCP Server

MCP server that exposes Sana Guard operations to AI agents.

## Tools

- `guard_transfer` — Build and sign a SOL or SPL token transfer
- `guard_status` — Check vault status and remaining budget
- `guard_policy` — View vault policy (read-only)
- `guard_payout_quote` — Get a 1Click payout quote (stretch goal)

## Status

**Placeholder** — Implementation pending (see [PLAN.md](../../docs/PLAN.md) § 8, day 9).

## Setup

```bash
pnpm install
pnpm build
```

Add to your MCP settings:

```json
{
  "mcpServers": {
    "sana-guard": {
      "command": "node",
      "args": ["/path/to/sana-guard/apps/mcp/dist/index.js"]
    }
  }
}
```

## Skill

See [skills/sana-guard/SKILL.md](../../skills/sana-guard/SKILL.md) for agent guidance.
