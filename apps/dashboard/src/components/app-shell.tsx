'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { publicConfig } from '@/lib/config';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { shortenAddress } from '@/lib/format';
import { ContractVersion } from './contract-version';
import { CopyButton } from './copy-button';
import { NetworkPill } from './network-pill';
import { PageBackdrop } from './page-backdrop';
import { SkipLink } from './skip-link';
import { Wordmark } from './sg-mark';
import { StatusBadge } from './status-badge';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export function AppShell({ children }: { children: ReactNode }) {
  const session = useOwnerSession();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative min-h-screen">
        <SkipLink />
        <PageBackdrop />
        <header className="sticky top-0 z-40 px-4 pt-4">
          <div className="mx-auto max-w-console">
            <nav className="flex flex-col gap-3 rounded-pill border border-border bg-card/80 px-4 py-3 shadow-e1 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
              <Link href="/" className="rounded-pill">
                <Wordmark compact />
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <NetworkPill network={publicConfig.nearNetwork} />
                <StatusBadge tone={session.privyEnabled ? 'ok' : 'warn'}>
                  {session.privyEnabled ? 'Privy configured' : 'Privy missing'}
                </StatusBadge>
                {session.authenticated && session.owner ? (
                  <>
                    <span className="font-mono text-muted-foreground">
                      {shortenAddress(session.owner)}
                    </span>
                    <CopyButton value={session.owner} label="Copy owner" />
                    <Button type="button" variant="outline" size="sm" onClick={session.logout}>
                      Sign out
                    </Button>
                  </>
                ) : session.privyEnabled ? (
                  <Button type="button" size="sm" onClick={session.login} disabled={!session.ready}>
                    Sign in
                  </Button>
                ) : null}
              </div>
            </nav>
          </div>
        </header>
        <main id="content" className="mx-auto max-w-console px-4 py-8">
          {children}
        </main>
        <footer className="mx-auto max-w-console px-4 pb-8">
          <div className="border-t border-divider pt-4">
            <ContractVersion />
          </div>
        </footer>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
