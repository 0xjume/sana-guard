'use client';

import { useEffect, useState } from 'react';
import { publicConfig } from '@/lib/config';
import { activityNearAccount, type ActivityItem } from '@/lib/activity';
import { AddressChip } from './address-chip';
import { StatusBadge } from './status-badge';
import { ProofLink } from './proof-link';
import { Activity } from 'lucide-react';
import { SectionHeader } from './section-header';
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import { Card, CardContent } from '@/components/ui/card';

export function ActivityFeed({ vaultId }: { vaultId: number }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchWithTimeout(
          `/api/activity?vaultId=${vaultId}`,
          {},
          'The activity feed'
        );
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
      <SectionHeader
        icon={Activity}
        kicker="Activity"
        title="Recent sign attempts"
        description={
          <>
            From the public NearBlocks history for {publicConfig.guardContract}. An empty indexer
            response is shown as <strong>no history source</strong>, not as an empty vault.
          </>
        }
        action={
          degraded ? (
            <StatusBadge tone="warn">
              {reason === 'no history source' ? 'no history source' : 'Indexer degraded'}
            </StatusBadge>
          ) : undefined
        }
      />
      <CardContent>
        {reason ? <p className="mb-3 text-xs text-warning">{reason}</p> : null}
        <ol className="space-y-3">
          {/* When the indexer failed, the reason above already says why; don't claim it was empty. */}
          {items.length === 0 && !(degraded && reason) ? (
            <li className="text-sm text-muted-foreground">
              {degraded
                ? 'No history source. NearBlocks returned no transactions for this contract.'
                : 'No indexed events for this vault yet.'}
            </li>
          ) : null}
          {items.map((item, index) => {
            const account = activityNearAccount(item);
            return (
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
                {item.detail && item.detail !== account ? (
                  <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                ) : null}
                {account ? (
                  <div className="mt-1">
                    <AddressChip value={account} chain="near" compact />
                  </div>
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
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
