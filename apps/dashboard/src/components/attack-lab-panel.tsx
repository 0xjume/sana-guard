'use client';

import { useEffect, useState } from 'react';
import { ATTACK_EXPECTED, ATTACK_KINDS, ATTACK_LABELS, type AttackKind } from '@/lib/attack-lab';
import { StatusBadge } from './status-badge';

export function AttackLabPanel({ vaultId }: { vaultId: number }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pinnedVaultId, setPinnedVaultId] = useState<number | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<AttackKind | null>(null);
  const [results, setResults] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void fetch('/api/attack-lab')
      .then((response) => response.json())
      .then((body: { enabled?: boolean; vaultId?: number | null }) => {
        setEnabled(Boolean(body.enabled));
        setPinnedVaultId(typeof body.vaultId === 'number' ? body.vaultId : null);
      })
      .catch(() => setEnabled(false));
  }, []);

  const run = async (kind: AttackKind) => {
    setBusy(kind);
    try {
      const response = await fetch('/api/attack-lab', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Attack-Lab-Token': token,
        },
        body: JSON.stringify({ kind }),
      });
      setResults(await response.json());
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel">
      <p className="kicker">Attack lab</p>
      <h2 className="mt-2 text-lg font-semibold">Policy-violating agent requests</h2>
      <p className="mt-2 text-sm text-parchment-400">
        Buttons call a server route that uses <code>DEMO_AGENT_*</code> to submit{' '}
        <code>request_sign</code>. Agent keys never enter this browser bundle. This page is vault{' '}
        {vaultId}. Attacks always run against pinned vault{' '}
        {pinnedVaultId === null ? (
          <code>DEMO_AGENT_VAULT_ID</code>
        ) : (
          <strong>{pinnedVaultId}</strong>
        )}{' '}
        (the client vault id is ignored) and require <code>X-Attack-Lab-Token</code>. Every payload
        is evaluated against a TS port of the contract rules before it is sent.
      </p>
      <div className="mt-3">
        {enabled === null ? (
          <StatusBadge tone="muted">Checking demo agent…</StatusBadge>
        ) : enabled ? (
          <StatusBadge tone="ok">Demo agent configured · pinned vault {pinnedVaultId}</StatusBadge>
        ) : (
          <StatusBadge tone="warn">
            Disabled — set DEMO_AGENT_ACCOUNT_ID, DEMO_AGENT_PRIVATE_KEY, DEMO_AGENT_VAULT_ID, and
            ATTACK_LAB_TOKEN
          </StatusBadge>
        )}
      </div>
      <label className="mt-4 block text-xs">
        Attack Lab token
        <input
          className="field mt-1"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="X-Attack-Lab-Token (not stored)"
        />
      </label>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {ATTACK_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="btn-ghost text-left"
            disabled={!enabled || busy !== null || token.trim() === ''}
            onClick={() => void run(kind)}
          >
            <div className="font-medium">{ATTACK_LABELS[kind]}</div>
            <div className="mt-1 text-[11px] text-parchment-400">
              Expect {ATTACK_EXPECTED[kind]}
            </div>
          </button>
        ))}
      </div>
      {busy ? (
        <p className="mt-3 text-xs text-parchment-400">Running {ATTACK_LABELS[busy]}…</p>
      ) : null}
      {results ? (
        <pre className="mt-4 overflow-x-auto rounded-sm bg-ink-950 p-3 text-[11px] text-parchment-100">
          {JSON.stringify(results, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
