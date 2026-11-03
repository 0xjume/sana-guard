'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { LogIn, LogOut } from 'lucide-react';
import { publicConfig } from '@/lib/config';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { AddressChip } from './address-chip';
import { ContractVersion } from './contract-version';
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
        <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4 sm:pt-4">
          <div className="mx-auto max-w-console">
            <nav className="flex items-center justify-between gap-2 overflow-hidden rounded-pill border border-border bg-card/80 px-2.5 py-2 shadow-e1 backdrop-blur-xl sm:gap-3 sm:px-4 sm:py-3">
              <Link href="/" className="shrink-0 rounded-pill">
                <Wordmark compact />
              </Link>
              <div className="flex min-w-0 items-center justify-end gap-1.5 text-xs sm:gap-2">
                <NetworkPill network={publicConfig.nearNetwork} />
                {/* Deployment config is a developer concern; visitors get the setup notice instead. */}
                {process.env.NODE_ENV === 'development' ? (
                  <StatusBadge
                    tone={session.privyEnabled ? 'ok' : 'warn'}
                    className="hidden sm:inline-flex"
                  >
                    {session.privyEnabled ? 'Privy configured' : 'Privy missing'}
                  </StatusBadge>
                ) : null}
                {session.authenticated && session.owner ? (
                  <>
                    <AddressChip value={session.owner} chain="solana" compact />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0 sm:hidden"
                      onClick={session.logout}
                    >
                      <LogOut aria-hidden className="size-4" />
                      <span className="sr-only">Sign out</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="hidden shrink-0 sm:inline-flex"
                      onClick={session.logout}
                    >
                      Sign out
                    </Button>
                  </>
                ) : session.privyEnabled ? (
                  <>
                    <Button
                      type="button"
                      size="icon"
                      className="h-8 w-8 shrink-0 sm:hidden"
                      onClick={session.login}
                      disabled={!session.ready}
                    >
                      <LogIn aria-hidden className="size-4" />
                      <span className="sr-only">Sign in</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="hidden shrink-0 sm:inline-flex"
                      onClick={session.login}
                      disabled={!session.ready}
                    >
                      Sign in
                    </Button>
                  </>
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
