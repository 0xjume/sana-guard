'use client';

import { useEffect, useState } from 'react';
import { publicConfig } from '@/lib/config';
import { createViews } from '@/lib/near';
import { pluralizeCount } from '@/lib/format';
import { StatusBadge } from './status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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
    <Card>
      <CardHeader>
        <p className="kicker">Live testnet</p>
        <CardTitle>Guard contract</CardTitle>
        <p className="break-all font-mono text-sm text-muted-foreground">
          {publicConfig.guardContract}
        </p>
      </CardHeader>
      <CardContent>
        {!snapshot ? (
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
        ) : snapshot.error ? (
          <p className="text-sm text-rejected">{snapshot.error}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="ok">
              {pluralizeCount(snapshot.vaultCount, 'vault')} visible
            </StatusBadge>
            {snapshot.programs.map((program) => (
              <StatusBadge key={program} tone="muted">
                {program.startsWith('1111') ? 'System' : program.slice(0, 12)}
              </StatusBadge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
