'use client';

import { useState } from 'react';
import { Bot, Lock, Power, ShieldCheck } from 'lucide-react';
import { CreateVaultForm } from '@/components/create-vault-form';
import { MissingConfig } from '@/components/missing-config';
import { NetworkStatus } from '@/components/network-status';
import { VaultList } from '@/components/vault-list';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { publicConfig } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const PILLARS = [
  {
    icon: Lock,
    title: 'Policy on NEAR',
    body: 'Caps, allowlists and expiry live in the guard contract, not in the agent.',
  },
  {
    icon: ShieldCheck,
    title: 'MPC-signed',
    body: 'The MPC network signs a Solana transaction only after it passes that policy.',
  },
  {
    icon: Power,
    title: 'Kill switch',
    body: 'Pause a vault instantly. Tightening is immediate; loosening waits out a delay.',
  },
];

const STEPS = [
  'Sign in with the owner wallet (Privy).',
  'Create a vault and fund its Solana address.',
  'Allowlist recipients, then add an agent key.',
  'The agent spends through the MCP server; the guard enforces every request.',
];

function Hero({ onSignIn }: { onSignIn?: () => void }) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-border bg-card/70 px-6 py-10 shadow-e1 backdrop-blur sm:px-10 sm:py-14">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,hsl(var(--primary)/0.22),transparent)] blur-2xl"
      />
      <p className="kicker">Owner console</p>
      <h1 className="mt-4 max-w-3xl font-heading text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
        Policy is <span className="text-primary">on-chain</span>. The dashboard only signs it.
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
        Sana Guard keeps per-vault policy on NEAR and lets AI agents spend from a Solana wallet only
        when each request passes it. Leaking an agent key or prompt-injecting the agent cannot get
        around the caps.
      </p>
      {onSignIn ? (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button type="button" size="pill" onClick={onSignIn}>
            Sign in as owner
          </Button>
          <a
            href="#how-it-works"
            className="rounded-pill px-3 py-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            How it works
          </a>
        </div>
      ) : null}
      <ul className="mt-10 grid gap-3 sm:grid-cols-3">
        {PILLARS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-md border border-border bg-background/40 p-4">
            <Icon aria-hidden className="size-5 text-primary" />
            <p className="mt-3 text-sm font-medium">{title}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HowItWorks() {
  return (
    <Card id="how-it-works" className="scroll-mt-28">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot aria-hidden className="size-4 text-primary" />
          <p className="kicker">How it works</p>
        </div>
        <ol className="mt-2 space-y-3">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-6">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 font-mono text-xs text-primary">
                {index + 1}
              </span>
              <span className="text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
      </CardHeader>
    </Card>
  );
}

export default function HomePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const session = useOwnerSession();
  const canSignIn = Boolean(publicConfig.privyAppId) && session.ready && !session.authenticated;

  return (
    <div className="space-y-6">
      {publicConfig.configError ? (
        <Card className="border-rejected-fill/40">
          <CardHeader>
            <p className="kicker">Configuration</p>
            <CardTitle className="text-2xl">Mainnet refused</CardTitle>
            <CardDescription>{publicConfig.configError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {!session.ready ? (
        <div
          className="min-h-[28rem] rounded-lg border border-border bg-card/70 sm:min-h-[32rem]"
          aria-busy="true"
        >
          <p className="sr-only">Loading owner session</p>
        </div>
      ) : session.authenticated ? (
        <h1 className="sr-only">Owner console</h1>
      ) : (
        <Hero onSignIn={canSignIn ? session.login : undefined} />
      )}
      {!publicConfig.privyAppId ? <MissingConfig /> : null}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {publicConfig.configError ? null : (
            <>
              <VaultList refreshKey={refreshKey} />
              {session.authenticated ? (
                <CreateVaultForm onCreated={() => setRefreshKey((value) => value + 1)} />
              ) : (
                <HowItWorks />
              )}
            </>
          )}
        </div>
        <aside className="space-y-6 lg:sticky lg:top-28">
          <NetworkStatus />
          {session.authenticated ? <HowItWorks /> : null}
        </aside>
      </div>
    </div>
  );
}
