'use client';

import { useEffect, useState } from 'react';
import { publicConfig } from '@/lib/config';
import { createViews } from '@/lib/near';
import { StatusBadge } from './status-badge';

interface Snapshot {
  programs: string[];
  vaultCount: number;
  error?: string;
}

export function NetworkStatus() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const views = createViews();
        const [programs, vaults] = await Promise.all([
          views.supportedPrograms(),
          views.listVaults(0, 50),
        ]);
        if (!cancelled) {
          setSnapshot({ programs, vaultCount: vaults.length });
        }
      } catch (error) {
        if (!cancelled) {
          setSnapshot({
            programs: [],
            vaultCount: 0,
            error: error instanceof Error ? error.message : 'NEAR view failed',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="panel">
      <p className="kicker">Live testnet</p>
      <h2 className="mt-2 text-lg font-semibold">Guard contract</h2>
      <p className="mt-2 font-mono text-sm text-parchment-400">{publicConfig.guardContract}</p>
      {!snapshot ? (
        <p className="mt-4 text-sm text-parchment-400">Reading NEAR views…</p>
      ) : snapshot.error ? (
        <p className="mt-4 text-sm text-rust-400">{snapshot.error}</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusBadge tone="ok">{snapshot.vaultCount} vaults visible</StatusBadge>
          {snapshot.programs.map((program) => (
            <StatusBadge key={program} tone="muted">
              {program.startsWith('1111') ? 'System' : program.slice(0, 12)}
            </StatusBadge>
          ))}
        </div>
      )}
    </section>
  );
}
