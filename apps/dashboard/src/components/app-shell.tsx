'use client';

import Link from 'next/link';
import { useState } from 'react';
import { publicConfig } from '@/lib/config';
import { useInviteToken } from '@/hooks/use-invite-token';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { CopyButton } from './copy-button';
import { StatusBadge } from './status-badge';

export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useOwnerSession();
  const invite = useInviteToken();
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-600 bg-ink-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-sm border border-brass-500/50 bg-ink-800 font-mono text-brass-400">
              SG
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-wide text-parchment-100">
                Sana Guard
              </span>
              <span className="block text-xs text-parchment-400">Owner console · testnet</span>
            </span>
          </Link>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge tone={publicConfig.nearNetwork === 'testnet' ? 'ok' : 'danger'}>
              {publicConfig.nearNetwork}
            </StatusBadge>
            <StatusBadge tone={session.privyEnabled ? 'ok' : 'warn'}>
              {session.privyEnabled ? 'Privy configured' : 'Privy missing'}
            </StatusBadge>
            {session.authenticated && session.owner ? (
              <>
                <span className="font-mono text-parchment-400">
                  {session.owner.slice(0, 4)}…{session.owner.slice(-4)}
                </span>
                <CopyButton value={session.owner} label="Copy owner" />
                <button type="button" className="btn-ghost" onClick={session.logout}>
                  Sign out
                </button>
              </>
            ) : session.privyEnabled ? (
              <button
                type="button"
                className="btn-primary"
                onClick={session.login}
                disabled={!session.ready}
              >
                Sign in
              </button>
            ) : null}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setInviteOpen((open) => !open)}
            >
              Invite token
            </button>
          </div>
        </div>
        {inviteOpen ? (
          <div className="border-t border-ink-600 bg-ink-800 px-4 py-3">
            <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center">
              <label className="text-xs text-parchment-400 sm:w-40">Relay X-Invite-Token</label>
              <input
                className="field"
                type="password"
                autoComplete="off"
                value={invite.token}
                onChange={(event) => invite.save(event.target.value)}
                placeholder="Required for CreateVault / AddAgent when the relay gate is on"
              />
            </div>
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
