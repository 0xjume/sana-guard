'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { OwnerVaultEntry } from '@/lib/near';
import { createViews, listOwnerVaults } from '@/lib/near';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { lamportsToSol } from '@/lib/format';
import { StatusBadge } from './status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
        <CardHeader>
          <p className="kicker">Vaults</p>
          <CardTitle>Sign in to see your vaults</CardTitle>
          <CardDescription>
            Owner identity is a Privy embedded Solana wallet. The dashboard reads{' '}
            <code>owner_vault_count</code> and filters <code>list_vaults</code> by that pubkey.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <p className="kicker">Vaults</p>
        <div className="flex items-end justify-between gap-3">
          <CardTitle>Your vaults</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">owner_vault_count {count}</span>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <p className="mb-3 text-sm text-rejected">{error}</p> : null}
        {rows && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No vaults yet for this owner.</p>
        ) : null}
        {!rows && !error ? (
          <div className="grid gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}
        <div className="grid gap-3">
          {rows?.map(({ id, vault }) => {
            const solLimit = vault.policy.perTxLimit.find((item) => item.mint.type === 'sol');
            return (
              <Link
                key={id}
                href={`/vaults/${id}`}
                className="block rounded-md border border-border bg-secondary/60 p-4 shadow-e0 motion-safe:transition-shadow hover:shadow-e2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm">Vault #{id}</div>
                    <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {vault.vaultAddress}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={vault.paused ? 'danger' : 'ok'}>
                      {vault.paused ? 'Paused' : vault.state}
                    </StatusBadge>
                    {vault.pendingLoosen ? (
                      <StatusBadge tone="warn">Pending loosen</StatusBadge>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  Per-tx {solLimit ? `${lamportsToSol(solLimit.amount)} SOL` : '—'} ·{' '}
                  {vault.agents.length} agents
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
