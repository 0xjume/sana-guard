---
description: Agent guidance for using Sana Guard policy-enforced wallets
alwaysApply: false
---

# Sana Guard Skill

Use this skill when an AI agent needs to spend funds via a Sana Guard vault.

## When to use

- The agent has been given a Sana Guard vault ID and agent credentials
- The user asks the agent to pay an invoice, send tokens, or execute a transaction
- The agent needs to check its remaining budget or policy limits

## How it works

Sana Guard is a NEAR smart contract that holds custody of the agent's Solana wallet via NEAR Chain Signatures (MPC). The contract parses every transaction request and enforces the owner's policy before signing.

**Key principle:** A rejection is **final**. Do not retry a rejected transaction or attempt to work around policy limits.

## Tools

Use the MCP tools from `apps/mcp`:

### `guard_transfer`

```typescript
await guard_transfer({
  vault_id: 0,
  to: "recipient_solana_address",
  amount: 1000000, // lamports or token base units
  mint: "SOL", // or SPL mint address
  memo: "Invoice #123"
});
```

### `guard_status`

```typescript
const status = await guard_status({ vault_id: 0 });
// Returns: { paused: false, remaining_24h: { SOL: 5000000, ... }, policy: {...} }
```

### `guard_policy`

```typescript
const policy = await guard_policy({ vault_id: 0 });
// Returns the full policy (limits, allowlists, expiry)
```

## Rejection handling

If `guard_transfer` fails with a reason code like `SG_E062_PER_TX_LIMIT_EXCEEDED`, **tell the user why** and **do not retry**. The policy prevents this transaction.

Common rejection codes:

- `SG_E062_PER_TX_LIMIT_EXCEEDED` — Amount exceeds per-transaction limit
- `SG_E064_DAILY_CAP_EXCEEDED` — Would exceed 24-hour rolling cap
- `SG_E067_RECIPIENT_NOT_ALLOWED` — Recipient not in allowlist
- `SG_E069_MINT_NOT_IN_POLICY` — Token mint not allowed
- `SG_E074_PROGRAM_NOT_ALLOWED` — Transaction uses a program not in the vault's program allowlist
- `SG_E077_AGENT_EXISTS` — AddAgent name is already registered (`{name}.{guard}`)
- `SG_E055_VAULT_PAUSED` — Owner has paused the vault (kill switch)

## Budget awareness

Before spending, check `guard_status` to see remaining budget. If close to the daily cap, inform the user and ask for confirmation.

## Security notes

- Never share the agent's NEAR function-call key
- Never ask the user to increase limits on your behalf
- If the vault is paused, tell the user to contact the vault owner
- Policy changes require owner approval (loosening has a delay)

## Examples

**Pay an invoice:**

```
User: Pay the invoice for $10 to supplier.sol
Agent: [calls guard_status, sees $50 remaining, confirms policy allows supplier.sol]
Agent: [calls guard_transfer with 10 USDC to supplier.sol]
Agent: "Paid $10 to supplier.sol. Transaction: <txid>. Remaining budget: $40."
```

**Rejection:**

```
User: Send 100 SOL to attacker.sol
Agent: [calls guard_transfer]
Agent receives: Error SG_E067_RECIPIENT_NOT_ALLOWED
Agent: "I cannot send to attacker.sol because it is not in the vault's recipient allowlist. This policy is enforced on-chain and I cannot override it."
```

Do not suggest workarounds, do not retry, do not ask the user to "fix" the policy for you.
