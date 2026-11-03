'use client';

import { useEffect, useState } from 'react';
import { publicConfig } from '@/lib/config';
import { createViews } from '@/lib/near';

type State =
  | { status: 'loading' }
  | { status: 'ok'; version: string; gitSha: string }
  | { status: 'legacy' }
  | { status: 'error' };

/** Footer line naming the guard contract and the code version it is running. */
export function ContractVersion() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    createViews()
      .contractVersion()
      .then((result) => {
        if (!cancelled) {
          setState(result ? { status: 'ok', ...result } : { status: 'legacy' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const versionText =
    state.status === 'ok'
      ? `v${state.version} · ${state.gitSha}`
      : state.status === 'legacy'
        ? 'version unknown (built before version())'
        : state.status === 'error'
          ? 'version unavailable'
          : '…';

  return (
    <p className="font-mono text-xs text-muted-foreground">
      <span>{publicConfig.guardContract}</span>
      <span aria-hidden> · </span>
      <span title="Contract version and the git commit it was built from">{versionText}</span>
    </p>
  );
}
