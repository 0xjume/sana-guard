# Sana Guard Relay

The Sana Guard Relay is a backend service that submits owner-signed admin messages to the NEAR guard contract. It validates messages, enforces rate limits and budgets, and pays the required NEAR deposits and gas fees.

## Architecture

```
Dashboard (Privy wallet) → signs admin message → Relay → validates & submits → guard.djume.testnet
```

**The relay is NOT in the signing path for agent transactions.** Agents call `request_sign` directly with their own function-call keys.

## Endpoints

### `POST /v1/admin`

Submit an owner-signed admin message.

**Request body:**

```json
{
  "action": { "type": "CreateVault", "owner": "...", "vault_address": "...", "policy": {...} },
  "vault": null,
  "nonce": 1,
  "expiry": "1234567890000000000",
  "signature": [0, 1, 2, ...]
}
```

The relay reconstructs the full admin message, verifies the signature, checks budgets, and submits to the guard contract.

**Response (success):**

```json
{
  "success": true,
  "txHash": "...",
  "depositNear": 0.5
}
```

**Response (failure):**

```json
{
  "success": false,
  "txHash": "...",
  "error": "SG_E062_PER_TX_LIMIT_EXCEEDED"
}
```

**Error codes:**

- `400` — Invalid message, signature, nonce, or expiry
- `401` — Invalid signature
- `404` — Vault not found
- `429` — Budget or rate limit exceeded
- `503` — Relay balance below floor

### `GET /v1/vaults/:id`

Fetch vault info from the guard contract.

**Response:**

```json
{
  "owner": "DeF8...",
  "vault_address": "Fkk515...",
  "path": "vault/DeF8.../0",
  "agents": ["agent1.guard.djume.testnet"],
  "policy": { ... },
  "paused": false
}
```

### `GET /v1/quote/:action`

Get the required deposit for an action.

**Query parameters (AddAgent only):**

- `gas_funding` — NEAR amount (e.g. `0.2`)

**Response:**

```json
{
  "action": "CreateVault",
  "depositNear": 0.5,
  "depositYocto": "500000000000000000000000",
  "estimatedGasNear": 0.1,
  "estimatedGasYocto": "100000000000000000000000",
  "totalNear": 0.6
}
```

### `GET /v1/health`

Health check endpoint.

**Response:**

```json
{
  "status": "healthy",
  "relayBalanceNear": 5.23,
  "relayBalanceFloor": 0.5,
  "network": "testnet",
  "guardContract": "guard.djume.testnet"
}
```

## Environment Variables

See `.env.example` for all configuration. Required variables:

- `RELAY_ACCOUNT_ID` — relay.djume.testnet
- `RELAY_NEAR_PRIVATE_KEY` — ed25519:... (never commit this)
- `NEAR_NETWORK` — testnet or mainnet
- `NEAR_RPC_URL` — https://rpc.testnet.near.org
- `GUARD_CONTRACT_ID` — guard.djume.testnet
- `DATABASE_URL` — sqlite:./relay.db or postgresql://...

Security settings:

- `RELAY_BALANCE_FLOOR_NEAR` — refuse requests below this balance
- `MAX_AGENT_GAS_FUNDING_NEAR` — cap for AddAgent gas_funding
- `GLOBAL_DAILY_BUDGET_NEAR` — total NEAR spending limit per day
- `MAX_DEPOSIT_PER_CALL_NEAR` — hard cap on any single deposit
- `OWNER_RATE_LIMIT_PER_HOUR` — max requests per owner per hour
- `OWNER_DAILY_BUDGET_NEAR` — max NEAR per owner per day

## Development

```bash
pnpm install
cp .env.example .env
# Fill in RELAY_NEAR_PRIVATE_KEY and other vars
pnpm dev
```

## Testing

```bash
# Unit tests with mocked NEAR RPC
pnpm test

# Live integration tests (view calls only, no transactions)
# Requires RELAY_NEAR_PRIVATE_KEY in .env
pnpm test:live
```

Test coverage:

- ✅ Admin message parsing (valid/invalid formats)
- ✅ Signature verification (valid/invalid/wrong length)
- ✅ Budget tracking and limits (owner rate limit, owner daily, global daily, hard cap)
- ✅ Deposit calculations (CreateVault, AddAgent, others)
- ✅ Balance floor check
- ✅ Live view calls to guard.djume.testnet (opt-in with `RELAY_LIVE=1`)

## Deployment

### Railway

1. Create a new project in Railway
2. Add a PostgreSQL database (optional; SQLite works for low traffic)
3. Set environment variables from `.env.example`
4. Connect your GitHub repo
5. Railway will detect `railway.json` and deploy automatically

The health check endpoint is `/v1/health`.

### Environment setup

- Node 22+
- NEAR account with sufficient balance (>= `RELAY_BALANCE_FLOOR_NEAR`)
- Private key stored securely (Railway secrets, not in code)

## Security & Threat Model

### What the relay CAN do

- **Submit owner-signed admin messages** to the guard contract and pay deposits + gas
- **Rate-limit** and **budget-cap** owner requests
- **Refuse service** if its balance is too low

### What the relay CANNOT do

- **Sign anything on behalf of owners or agents.** The relay never holds owner private keys. Owner signatures are created in the dashboard (Privy embedded wallets). Agent signatures are created by the MPC contract in response to `request_sign` calls.
  
- **Move vault funds.** The relay only submits admin actions (CreateVault, AddAgent, Pause, etc.). It has no access to agent function-call keys and cannot call `request_sign`.

- **Bypass on-chain checks.** The guard contract validates every message: signature, nonce, expiry, domain tag, network, and contract ID. If the relay submits a bad message, the contract rejects it and the transaction fails (with a hash).

### Attack scenarios

#### Scenario 1: Relay private key is compromised

**Impact:** The attacker can submit arbitrary owner-signed admin messages, paying deposits from the relay balance, until:

- The relay balance drops below `RELAY_BALANCE_FLOOR_NEAR` (the relay stops accepting requests)
- The owner's daily budget is exhausted
- The global daily budget is exhausted

**Vault funds are safe:** The attacker still cannot move SOL or SPL tokens because:

1. They don't have owner private keys (to sign admin messages)
2. They don't have agent function-call keys (to call `request_sign`)
3. Even if they forge an admin message, the guard contract verifies the signature against the vault owner's public key

**Mitigation:**

- Rotate the relay key
- Monitor relay balance and daily spending
- Set conservative budgets

#### Scenario 2: Relay is down or refuses service

**Impact:** Admin operations (CreateVault, AddAgent, etc.) are temporarily unavailable. Existing vaults and agents are unaffected. Agent signing (`request_sign`) continues to work because agents call the contract directly.

**Mitigation:**

- Deploy the relay with high availability (multiple instances, health checks)
- Monitor the health endpoint
- Keep the relay balance above the floor

#### Scenario 3: Database is corrupted or lost

**Impact:** Rate limits and budget tracking reset. An attacker with a valid owner signature could bypass daily limits until the database is restored.

**Vault funds are safe:** The on-chain nonce prevents replay attacks. The guard contract's per-tx and daily caps still apply.

**Mitigation:**

- Regular database backups
- Use a managed database (Railway Postgres)
- Set conservative on-chain policy limits

### Summary

A compromised relay can drain its own NEAR balance by submitting forged owner-signed messages, but it **cannot move vault funds** because:

1. Vault funds are controlled by MPC-derived Solana keys
2. Only agents with function-call keys can request MPC signatures
3. The relay has no agent keys
4. The guard contract enforces recipient allowlists, spending limits, and program restrictions

The relay is a **convenience service** that reduces friction for dashboard users. If it's unavailable, owners can still submit admin messages directly using their own NEAR accounts (though they'd pay deposits themselves).

## Admin Message Format

The relay reconstructs this exact format before submission:

```
SANA-GUARD-ADMIN-v1
network: near-testnet
contract: guard.djume.testnet
vault: null
nonce: 1
expires: 1234567890000000000
action: {"type":"CreateVault","owner":"...","vault_address":"...","policy":{...}}
```

The signature is computed over this entire string (UTF-8 bytes) using ed25519.

## Deposits

| Action | Deposit |
|--------|---------|
| CreateVault | 0.5 NEAR (contract storage) |
| AddAgent | `gas_funding` + 0.05 NEAR (agent account + storage) |
| Others (Pause, Unpause, AddRecipient, etc.) | 0 NEAR |

Gas cost is estimated at 0.1 NEAR per transaction. The relay tracks `deposit + gas` against budgets.

## License

MIT
