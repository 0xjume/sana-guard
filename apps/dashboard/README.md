# Sana Guard Dashboard

Next.js web dashboard for vault owners to manage policies, agents, and monitor activity.

## Features

- Privy authentication (Solana embedded wallets)
- Vault creation and policy editor
- Agent management (add/remove)
- Kill switch (pause/unpause)
- Live feed of sign requests and rejections
- Attack lab demo buttons

## Status

**Placeholder** — Implementation pending (see [PLAN.md](../../docs/PLAN.md) § 8, day 8).

## Setup

```bash
pnpm install
cp .env.example .env.local
# Fill in NEXT_PUBLIC_PRIVY_APP_ID, NEXT_PUBLIC_NEAR_NETWORK, etc.
pnpm dev
```

## Tech Stack

- Next.js 15
- Privy for Solana wallet auth
- TailwindCSS
- near-api-js / near-kit

## Deployment

Vercel (see PLAN.md § 8).
