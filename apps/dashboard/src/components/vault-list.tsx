'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { OwnerVaultEntry } from '@/lib/near';
import { createViews, listOwnerVaults } from '@/lib/near';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { lamportsToSol } from '@/lib/format';
import { StatusBadge } from './status-badge';

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
      <section className="panel">
        <p className="kicker">Vaults</p>
        <h2 className="mt-2 text-lg font-semibold">Sign in to see your vaults</h2>
        <p className="mt-2 text-sm text-parchment-400">
          Owner identity is a Privy embedded Solana wallet. The dashboard reads{' '}
          <code>owner_vault_count</code> and filters <code>list_vaults</code> by that pubkey.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <p className="kicker">Vaults</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">Your vaults</h2>
        <span className="text-xs text-parchment-400">owner_vault_count {count}</span>
      </div>
      {error ? <p className="mt-3 text-sm text-rust-400">{error}</p> : null}
      {rows && rows.length === 0 ? (
        <p className="mt-4 text-sm text-parchment-400">No vaults yet for this owner.</p>
      ) : null}
      <div className="mt-4 grid gap-3">
        {rows?.map(({ id, vault }) => {
          const solLimit = vault.policy.perTxLimit.find((item) => item.mint.type === 'sol');
          return (
            <Link
              key={id}
              href={`/vaults/${id}`}
              className="block rounded-sm border border-ink-600 bg-ink-800 p-4 hover:border-brass-500/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-sm">Vault #{id}</div>
                  <div className="mt-1 break-all font-mono text-xs text-parchment-400">
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
              <div className="mt-3 text-xs text-parchment-400">
                Per-tx {solLimit ? `${lamportsToSol(solLimit.amount)} SOL` : '—'} ·{' '}
                {vault.agents.length} agents
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
