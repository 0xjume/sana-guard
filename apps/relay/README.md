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
  "msg": "SANA-GUARD-ADMIN-v1\nnetwork: near-testnet\n...",
  "signature": [0, 1, 2, ...],
  "owner": "DeF8... (required except CreateVault; used to verify the sig before any RPC)"
}
```

The relay verifies ed25519 over those exact `msg` bytes, then parses the 7 signed lines. It never rebuilds the message with `JSON.stringify`.

**Headers:**
- `X-Invite-Token`: required for CreateVault/AddAgent when `INVITE_TOKEN` is set (the gate is on by default)

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

- `400` — Invalid message, signature, nonce, expiry, vault header mismatch
- `401` — Invalid signature
- `403` — Invite gate or allowlist denied
- `404` — Vault not found
- `409` — Nonce already in flight
- `413` — Request body larger than 16 KB (enforced on bytes read, including chunked)
- `429` — Budget, rate limit, or action limit exceeded
- `500` — Internal error (RPC details are logged, never returned)
- `503` — Relay balance below floor, or send timed out with no tx hash (reservation held)

### `GET /v1/vaults/:id`

Fetch vault info from the guard contract.

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
  "estimatedGasNear": "0.1",
  "estimatedGasYocto": "100000000000000000000000",
  "totalYocto": "600000000000000000000000",
  "totalNear": "0.6"
}
```

### `GET /v1/health`

Health check endpoint.

## Environment Variables

See `.env.example` for all configuration. Required variables:

- `RELAY_ACCOUNT_ID` — relay.djume.testnet
- `RELAY_NEAR_PRIVATE_KEY` — ed25519:... (never commit this)
- `NEAR_NETWORK` — testnet or mainnet
- `NEAR_RPC_URL` — https://rpc.testnet.near.org
- `GUARD_CONTRACT_ID` — guard.djume.testnet
- `MPC_CONTRACT_ID` — optional; `v1.signer-prod.testnet` on testnet, `v1.signer` on mainnet
- `DATABASE_URL` — sqlite:./relay.db

Security settings:

- `RELAY_BALANCE_FLOOR_NEAR` — refuse requests below this balance (default: 0.5)
- `MAX_AGENT_GAS_FUNDING_NEAR` — cap for AddAgent gas_funding (default: 0.5)
- `GLOBAL_DAILY_BUDGET_NEAR` — total NEAR spending limit per day (default: **1.0**)
- `MAX_DEPOSIT_PER_CALL_NEAR` — hard cap on any single deposit (default: 2.0)
- `OWNER_RATE_LIMIT_PER_HOUR` — max requests per owner per hour (default: 30)
- `OWNER_DAILY_BUDGET_NEAR` — max NEAR per owner per day (default: **0.3 × global**, so 0.3 NEAR when the global cap is 1). CreateVault reserves ~0.6 NEAR before reconcile, so raise this (e.g. `0.7`) if invited owners should create vaults through the relay

Anti-drain gates (on by default for CreateVault / AddAgent):

- `ADMIN_GATE_ENABLED` — default `true`. If true and neither token nor allowlist is set, CreateVault/AddAgent return 403
- `INVITE_TOKEN` — require this token in `X-Invite-Token` for CreateVault/AddAgent (compared in constant time)
- `OWNER_ALLOWLIST` — comma-separated allowed owner pubkeys (base58)
- `CORS_ORIGINS` — comma-separated allow-list. **Closed by default** (unset = empty list, no `*`). Preflight `OPTIONS` keeps `Access-Control-*` headers for allowed origins.
- `TRUST_PROXY` — default `false`. Set `true` only as a **Railway service variable** (Variables tab) so the limiter uses Railway's `X-Forwarded-For`. Do not bake it into the image or `railway.json`; a Docker run without that proxy would then be spoofable via `XFF`. Optionally `TRUST_PROXY_HOPS=1`. Leave unset/`false` locally. Admin and read paths use separate limiter maps.

## Development

```bash
pnpm install
cp .env.example .env
# Fill in RELAY_NEAR_PRIVATE_KEY and other vars
pnpm dev
```

## Testing

```bash
# Unit tests (NEAR RPC mocked)
pnpm test

# Live integration tests (view calls + one real AddRecipient on testnet)
# Requires RELAY_NEAR_PRIVATE_KEY and OWNER_KEY_PATH in .env
RELAY_LIVE=1 pnpm test
```

Test coverage:

- ✅ Admin message parsing (valid/invalid formats)
- ✅ Signature verification (valid/invalid/wrong length)
- ✅ Budget tracking and limits (owner rate limit, owner daily, global daily, hard cap)
- ✅ Deposit calculations (exact BigInt yocto constants, no float precision issues)
- ✅ Gas values (100 Tgas normal, 150 Tgas AddAgent, validated range 1e14–3e14)
- ✅ Balance floor check (before every send, inside the global + owner lock)
- ✅ CORS closed by default; invite token compared via SHA-256 + `timingSafeEqual`
- ✅ Body limit on bytes actually read (chunked bodies, no Content-Length)
- ✅ `X-Forwarded-For` trusted only when `TRUST_PROXY` is set
- ✅ Budget reserved at the prepaid-gas ceiling, then reconciled to `tokens_burnt`
- ✅ Send timeouts with a hash stay `unknown` until txStatus or expiry+nonce settle; pre-sign failures release immediately
- ✅ Global budget + floor check-and-reserve under one global lock / SQLite transaction
- ✅ Live testnet: AddRecipient submission with real tx hash

## Deployment

### Railway

1. Create a new project in Railway
2. Add environment variables from `.env.example`
3. Create a **persistent volume** mounted at `/app/relay.db` (or `/data/relay.db` with `DATABASE_URL=sqlite:/data/relay.db`) so daily budgets survive redeploys
4. In the Railway service **Variables** tab, set `TRUST_PROXY=true` so the per-IP limiter uses Railway's `X-Forwarded-For`. The image and `railway.json` default to `false`; do not set it there. Leave it unset/`false` if the service is not behind that proxy.
5. Set `CORS_ORIGINS` to the dashboard origin(s). Unset means no browser origin is allowed
6. Connect your GitHub repo
7. Railway will detect `railway.json` and deploy automatically

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

#### Scenario 3: CreateVault drain (public demo)

**Impact:** CreateVault is permissionless and new Solana keys are free. Without gates, an attacker can drain the relay by creating unlimited vaults.

**Mitigation (required for public demo):**

- Enable `INVITE_TOKEN` to require an invite token in the `X-Invite-Token` header
- Enable `OWNER_ALLOWLIST` to restrict CreateVault/AddAgent to specific owner pubkeys
- Set a low `GLOBAL_DAILY_BUDGET_NEAR` (default: 1 NEAR/day)
- Per-owner daily budget defaults to **0.3** of the global budget (0.3 NEAR/day)
- Daily action count limits: CreateVault max 3/day, AddAgent max 5/day

**Default configuration:** `ADMIN_GATE_ENABLED=true`. CreateVault and AddAgent are refused until you set `INVITE_TOKEN` and/or `OWNER_ALLOWLIST`. The global daily budget defaults to 1 NEAR; each owner gets 0.3 of that unless `OWNER_DAILY_BUDGET_NEAR` is set. Daily count caps: CreateVault 3, AddAgent 5. Set `ADMIN_GATE_ENABLED=false` only for a private, trusted deployment.

#### Scenario 4: Database is corrupted or lost

**Impact:** Rate limits and budget tracking reset. An attacker with a valid owner signature could bypass daily limits until the database is restored.

**Vault funds are safe:** The on-chain nonce prevents replay attacks. The guard contract's per-tx and daily caps still apply.

**Mitigation:**

- Use a **persistent volume** for the SQLite file (Railway: mount at the `DATABASE_URL` path, e.g. `/data/relay.db`). Without a volume, budgets reset on every redeploy.
- Regular database backups
- Set conservative on-chain policy limits

### Summary

A compromised relay can drain its own NEAR balance by submitting forged owner-signed messages, but it **cannot move vault funds** because:

1. Vault funds are controlled by MPC-derived Solana keys
2. Only agents with function-call keys can request MPC signatures
3. The relay has no agent keys
4. The guard contract enforces recipient allowlists, spending limits, and program restrictions

The relay is a **convenience service** that reduces friction for dashboard users. If it's unavailable, owners can still submit admin messages directly using their own NEAR accounts (though they'd pay deposits themselves).

## Admin Message Format

The relay expects the raw signed message string:

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

**Important:** The relay does NOT rebuild the message. It validates and passes the exact signed string to `owner_action`. This prevents signature mismatches from JSON encoding differences (e.g., Unicode escaping).

## Deposits

| Action | Deposit |
|--------|---------|
| CreateVault | 0.5 NEAR (contract storage) |
| AddAgent | `gas_funding` + 0.05 NEAR (agent account + storage) |
| Others (Pause, Unpause, AddRecipient, BackfillRecipients, etc.) | 0 NEAR |

**Gas:**
- Normal actions: 100 Tgas
- AddAgent: 150 Tgas

**AddAgent constraints:**
- Minimum `gas_funding`: 0.15 NEAR
- Maximum `gas_funding`: 0.5 NEAR

Prepaid gas is reserved at ~1e9 yocto/gas (100 Tgas ≈ 0.1 NEAR, 150 Tgas ≈ 0.15 NEAR) as a ceiling. After each send the relay reconciles the reservation down to `deposit + tokens_burnt` from the tx outcome (typically ~0.0003 NEAR of gas). A 1 NEAR/day global cap therefore allows far more than ~10 calls.

## Concurrency

The relay uses a **global lock** plus a per-owner lock (the owner-lock map is capped and idle entries are evicted):

1. Rate-limit the client IP (before any RPC view)
2. Verify the signature locally
3. Take the global lock, then the owner lock
4. Check that the nonce is not in flight (409 if duplicate)
5. Verify on-chain nonce freshness
6. **Check the balance floor** (must have `deposit + reserved gas + floor` remaining)
7. Check-and-reserve the owner + global budgets in **one SQLite transaction**
8. Submit to NEAR
9. Reconcile the reservation to `deposit + tokens_burnt`
10. If the send errors with **no tx hash** (timeout), mark the row `unknown` and keep the reservation. A background pass resolves it later via `txStatus` when a hash is known
11. Unlock

This prevents:
- Two requests with the same nonce from both passing the nonce check
- Two owners racing the global budget or floor
- Budget double-spending
- Balance floor breaches
- Treating a timeout as a release (which would let a later retry spend again while the first tx might still land)

## License

MIT
