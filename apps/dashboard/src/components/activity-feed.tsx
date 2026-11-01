'use client';

import { useEffect, useState } from 'react';
import { publicConfig } from '@/lib/config';
import type { ActivityItem } from '@/lib/activity';
import { StatusBadge } from './status-badge';
import { ProofLink } from './proof-link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ActivityFeed({ vaultId }: { vaultId: number }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/activity?vaultId=${vaultId}`);
        const body = (await response.json()) as {
          items?: ActivityItem[];
          degraded?: boolean;
          reason?: string;
        };
        if (!cancelled) {
          setItems(body.items ?? []);
          setDegraded(Boolean(body.degraded));
          setReason(body.reason ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setDegraded(true);
          setReason(error instanceof Error ? error.message : 'Activity unavailable');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vaultId]);

  return (
    <Card>
      <CardHeader>
        <p className="kicker">Activity</p>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Recent sign attempts</CardTitle>
          {degraded ? (
            <StatusBadge tone="warn">
              {reason === 'no history source' ? 'no history source' : 'Indexer degraded'}
            </StatusBadge>
          ) : null}
        </div>
        <CardDescription>
          Pulled from the public NearBlocks testnet account history for {publicConfig.guardContract}
          . The relay has no activity endpoint. An empty indexer response is shown as{' '}
          <strong>no history source</strong>, not as an empty vault.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {reason ? <p className="mb-3 text-xs text-warning">{reason}</p> : null}
        <ol className="space-y-3">
          {items.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              {degraded
                ? 'No history source. NearBlocks returned no transactions for this contract.'
                : 'No indexed events for this vault yet.'}
            </li>
          ) : null}
          {items.map((item, index) => (
            <li
              key={`${item.txHash ?? 'x'}-${item.kind}-${index}`}
              className="border-l border-divider pl-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={
                    item.kind.includes('reject') || item.kind.includes('fail')
                      ? 'danger'
                      : item.kind === 'signed'
                        ? 'ok'
                        : 'muted'
                  }
                >
                  {item.title}
                </StatusBadge>
                {item.timestampMs ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(item.timestampMs).toISOString()}
                  </span>
                ) : null}
              </div>
              {item.detail ? (
                <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
              ) : null}
              {item.reqId ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground">req {item.reqId}</p>
              ) : null}
              {item.txHash ? (
                <div className="mt-2">
                  <ProofLink
                    value={item.txHash}
                    kind="near-tx"
                    finalized={item.kind === 'signed'}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
