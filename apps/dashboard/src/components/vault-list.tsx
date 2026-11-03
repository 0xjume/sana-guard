'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { OwnerVaultEntry } from '@/lib/near';
import { createViews, listOwnerVaults } from '@/lib/near';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { ChevronRight, Wallet } from 'lucide-react';
import { formatSol } from '@/lib/format';
import { AddressChip } from './address-chip';
import { SectionHeader } from './section-header';
import { StatusBadge } from './status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function VaultList({ refreshKey = 0 }: { refreshKey?: number }) {
  const session = useOwnerSession();
  const [rows, setRows] = useState<OwnerVaultEntry[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.owner) {
      setRows(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await listOwnerVaults(session.owner!, createViews());
        if (!cancelled) {
          setRows(result.vaults);
          setCount(result.count);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load vaults');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.owner, refreshKey]);

  if (!session.authenticated) {
    return (
      <Card>
        <SectionHeader
          icon={Wallet}
          kicker="Vaults"
          title="Your vaults"
          description="Sign in with the owner wallet above to list vaults for that public key."
        />
      </Card>
    );
  }

  return (
    <Card>
      <SectionHeader
        icon={Wallet}
        kicker="Vaults"
        title="Your vaults"
        action={
          <span className="rounded-pill border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {count} total
          </span>
        }
      />
      <CardContent>
        {error ? <p className="mb-3 text-sm text-rejected">{error}</p> : null}
        {rows && rows.length === 0 ? (
          <div className="grid place-items-center rounded-md border border-dashed border-border px-6 py-10 text-center">
            <Wallet aria-hidden className="size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No vaults yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Create one below. Its Solana address is derived by the MPC network and verified
              on-chain.
            </p>
          </div>
        ) : null}
        {!rows && !error ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {rows?.map(({ id, vault }) => {
            const solLimit = vault.policy.perTxLimit.find((item) => item.mint.type === 'sol');
            const solCap = vault.policy.dailyCap.find((item) => item.mint.type === 'sol');
            return (
              <div
                key={id}
                className="group flex flex-col rounded-md border border-border bg-background/40 p-4 motion-safe:transition hover:border-primary/40 hover:bg-secondary/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/vaults/${id}`} className="font-heading text-base font-semibold">
                      Vault {id}
                    </Link>
                    <div className="mt-1">
                      <AddressChip value={vault.vaultAddress} chain="solana" compact />
                    </div>
                  </div>
                  <Link
                    href={`/vaults/${id}`}
                    className="grid size-8 shrink-0 place-items-center rounded-pill text-muted-foreground hover:text-primary"
                    aria-label={`Open vault ${id}`}
                  >
                    <ChevronRight
                      aria-hidden
                      className="size-4 motion-safe:transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <StatusBadge tone={vault.paused ? 'danger' : 'ok'}>
                    {vault.paused ? 'Paused' : vault.state}
                  </StatusBadge>
                  {vault.pendingLoosen ? (
                    <StatusBadge tone="warn">Pending loosen</StatusBadge>
                  ) : null}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-divider pt-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Per-tx</dt>
                    <dd className="mt-0.5 font-mono">
                      {solLimit ? formatSol(solLimit.amount, { unit: false }) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">24h cap</dt>
                    <dd className="mt-0.5 font-mono">
                      {solCap ? formatSol(solCap.amount, { unit: false }) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Agents</dt>
                    <dd className="mt-0.5 font-mono">{vault.agents.length}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
