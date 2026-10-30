# Sana Guard Relay

Node.js relay service that submits owner-signed admin messages to the guard contract and pays gas.

## Features

- Validates owner signatures before submission
- Indexes contract events for the dashboard
- Rate limiting per owner
- Optional transaction broadcast endpoint for agents

## Status

**Placeholder** — Implementation pending (see [PLAN.md](../../docs/PLAN.md) § 8, day 7).

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, RPC_URL
pnpm dev
```

## API

- `POST /owner-action` — Submit an owner-signed admin message
- `POST /broadcast` — Broadcast a signed Solana transaction (optional)
- `GET /events/:vault_id` — Query indexed events

## Deployment

Railway or Cloudflare Worker (see PLAN.md § 8).
