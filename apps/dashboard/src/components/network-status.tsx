'use client';

import { useEffect, useState } from 'react';
import { publicConfig } from '@/lib/config';
import { createViews } from '@/lib/near';
import { Server } from 'lucide-react';
import { programLabel } from '@/lib/format';
import { SectionHeader } from './section-header';
import { StatusBadge } from './status-badge';
import { Card, CardContent } from '@/components/ui/card';
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
      <SectionHeader
        icon={Server}
        kicker={`Live ${publicConfig.nearNetwork}`}
        title="Guard contract"
        description={
          <span className="break-all font-mono text-xs">{publicConfig.guardContract}</span>
        }
      />
      <CardContent>
        {!snapshot ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-6 w-3/4" />
          </div>
        ) : snapshot.error ? (
          <p className="text-sm text-rejected">{snapshot.error}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between rounded-md border border-border bg-background/40 px-4 py-3">
              <span className="text-xs text-muted-foreground">Vaults on contract</span>
              <span className="font-mono text-lg">{snapshot.vaultCount}</span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Supported programs</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {snapshot.programs.map((program) => (
                  <StatusBadge key={program} tone="muted">
                    {programLabel(program)}
                  </StatusBadge>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
