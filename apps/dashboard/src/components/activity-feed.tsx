'use client';

import { useEffect, useState } from 'react';
import { nearExplorerTxUrl, publicConfig } from '@/lib/config';
import type { ActivityItem } from '@/lib/activity';
import { StatusBadge } from './status-badge';

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
    <section className="panel">
      <p className="kicker">Activity</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Recent sign attempts</h2>
        {degraded ? <StatusBadge tone="warn">Indexer degraded</StatusBadge> : null}
      </div>
      <p className="mt-2 text-sm text-parchment-400">
        Pulled from the public NearBlocks testnet account history for {publicConfig.guardContract}.
        The relay has no activity endpoint. Empty or degraded results are expected if the indexer
        lags.
      </p>
      {reason ? <p className="mt-3 text-xs text-brass-400">{reason}</p> : null}
      <ol className="mt-4 space-y-3">
        {items.length === 0 ? (
          <li className="text-sm text-parchment-400">No indexed events for this vault yet.</li>
        ) : null}
        {items.map((item, index) => (
          <li
            key={`${item.txHash ?? 'x'}-${item.kind}-${index}`}
            className="border-l border-ink-600 pl-3"
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
                <span className="text-xs text-parchment-400">
                  {new Date(item.timestampMs).toISOString()}
                </span>
              ) : null}
            </div>
            {item.detail ? <p className="mt-1 text-xs text-parchment-400">{item.detail}</p> : null}
            {item.reqId ? (
              <p className="mt-1 font-mono text-[11px] text-parchment-400">req {item.reqId}</p>
            ) : null}
            {item.txHash ? (
              <a
                className="mt-1 inline-block text-xs text-brass-400 underline"
                href={nearExplorerTxUrl(publicConfig.nearNetwork, item.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                NEAR tx
              </a>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
