'use client';

import { useEffect, useId, useState } from 'react';
import { ATTACK_EXPECTED, ATTACK_KINDS, ATTACK_LABELS, type AttackKind } from '@/lib/attack-lab';
import { AttackAttemptCard, type AttackLabResult } from './attack-attempt-card';
import { StatusBadge } from './status-badge';
import { Button } from '@/components/ui/button';
import { FlaskConical } from 'lucide-react';
import { SectionHeader } from './section-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AttackLabPanel({ vaultId }: { vaultId: number }) {
  const fieldId = useId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pinnedVaultId, setPinnedVaultId] = useState<number | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<AttackKind | null>(null);
  const [results, setResults] = useState<AttackLabResult | null>(null);

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
      setResults((await response.json()) as AttackLabResult);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <SectionHeader
        icon={FlaskConical}
        tone="warn"
        kicker="Attack lab"
        title="Try to break the policy"
        description={
          <>
            Each button sends a request that breaks one rule, as a compromised agent would. The
            guard contract should reject every one. Attacks run as the demo agent against{' '}
            {pinnedVaultId === null ? 'its demo vault' : <strong>vault {pinnedVaultId}</strong>}
            {pinnedVaultId !== null && pinnedVaultId !== vaultId
              ? `, not the vault you are viewing (${vaultId})`
              : ''}
            . The demo agent's key stays on the server.
          </>
        }
      />
      <CardContent>
        <div>
          {enabled === null ? (
            <StatusBadge tone="muted">Checking demo agent…</StatusBadge>
          ) : enabled ? (
            <StatusBadge tone="ok">
              Demo agent configured · pinned vault {pinnedVaultId}
            </StatusBadge>
          ) : (
            <StatusBadge tone="warn">Attack lab is not set up on this deployment</StatusBadge>
          )}
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor={`${fieldId}-token`}>Attack Lab token</Label>
          <Input
            id={`${fieldId}-token`}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Provided by the deployment owner (not stored)"
          />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {ATTACK_KINDS.map((kind) => (
            <Button
              key={kind}
              type="button"
              variant="outline"
              className="h-auto flex-col items-start whitespace-normal py-3 text-left"
              disabled={!enabled || busy !== null || token.trim() === ''}
              onClick={() => void run(kind)}
            >
              <span className="font-medium">{ATTACK_LABELS[kind]}</span>
              <span className="mt-1 font-mono text-xs text-muted-foreground">
                Expect {ATTACK_EXPECTED[kind]}
              </span>
            </Button>
          ))}
        </div>
        {busy ? (
          <p className="mt-3 text-xs text-muted-foreground">Running {ATTACK_LABELS[busy]}…</p>
        ) : null}
        {results ? (
          <div className="mt-4 space-y-3">
            <AttackAttemptCard result={results} />
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Raw response
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-background p-3 font-mono text-xs text-foreground">
                {JSON.stringify(results, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
