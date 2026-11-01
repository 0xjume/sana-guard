'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Policy, VaultView } from '@sana-guard/sdk';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { publicConfig } from '@/lib/config';
import { formatDurationNs, formatTimestampNs, lamportsToSol, nsToDate } from '@/lib/format';
import { clonePolicy, createViews, getSolanaBalanceLamports } from '@/lib/near';
import { ActionResult } from './action-result';
import { ActivityFeed } from './activity-feed';
import { AgentsPanel } from './agents-panel';
import { AttackLabPanel } from './attack-lab-panel';
import { CopyButton } from './copy-button';
import { PolicyEditor } from './policy-editor';
import { ProofLink } from './proof-link';
import { RecipientsPanel } from './recipients-panel';
import { SpendMeter } from './spend-meter';
import { StatusBadge } from './status-badge';
import type { GuardActionError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

function Countdown({ effectiveNs }: { effectiveNs: bigint }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remainingMs = nsToDate(effectiveNs).getTime() - now;
  if (remainingMs <= 0) {
    return <StatusBadge tone="ok">Delay elapsed — anyone can apply_pending_policy</StatusBadge>;
  }
  const seconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rem = seconds % 60;
  return (
    <StatusBadge tone="warn">
      Effective in {hours}h {minutes}m {rem}s
    </StatusBadge>
  );
}

function PolicySummary({ policy }: { policy: Policy }) {
  const solLimit = policy.perTxLimit.find((item) => item.mint.type === 'sol');
  const solCap = policy.dailyCap.find((item) => item.mint.type === 'sol');
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-muted-foreground">Per-tx SOL</dt>
        <dd className="font-mono">{solLimit ? `${lamportsToSol(solLimit.amount)} SOL` : '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Rolling 24h SOL cap</dt>
        <dd className="font-mono">{solCap ? `${lamportsToSol(solCap.amount)} SOL` : '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">max_priority_fee_lamports</dt>
        <dd className="font-mono">{policy.maxPriorityFeeLamports.toString()}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">max_total_priority_fee_lamports</dt>
        <dd className="font-mono">{policy.maxTotalPriorityFeeLamports?.toString() ?? 'none'}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Expiry</dt>
        <dd>{formatTimestampNs(policy.expiresAtNs)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Loosen delay</dt>
        <dd>{formatDurationNs(policy.loosenDelayNs)}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs text-muted-foreground">Programs</dt>
        <dd className="mt-1 flex flex-wrap gap-2">
          {policy.programs.map((program) => (
            <StatusBadge key={program} tone="muted">
              {program.slice(0, 12)}
            </StatusBadge>
          ))}
        </dd>
      </div>
    </dl>
  );
}

export function VaultDetail({ vaultId }: { vaultId: number }) {
  const session = useOwnerSession();
  const [vault, setVault] = useState<VaultView | null>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [spend, setSpend] = useState<Array<{ mint: string; amount: bigint }>>([]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<GuardActionError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const views = createViews();
    const next = await views.getVault(vaultId);
    if (!next) {
      setVault(null);
      setError('Vault not found');
      return;
    }
    const [nextRecipients, nextSpend] = await Promise.all([
      views.getRecipients(vaultId),
      views.getSpend24h(vaultId),
    ]);
    setVault(next);
    setRecipients(nextRecipients);
    setSpend(nextSpend);
    setError(null);
    try {
      setBalance(await getSolanaBalanceLamports(next.vaultAddress));
    } catch {
      setBalance(null);
    }
  }, [vaultId]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load vault');
    });
  }, [load]);

  const run = async (
    fn: () => Promise<{ success: boolean; txHash?: string; error?: GuardActionError }>
  ) => {
    setBusy(true);
    setActionError(null);
    setTxHash(null);
    try {
      const result = await fn();
      if (result.success && result.txHash) {
        setTxHash(result.txHash);
        await load();
      } else if (!result.success && result.error) {
        setActionError(result.error);
      }
    } catch (err) {
      setActionError({ message: err instanceof Error ? err.message : 'Action failed' });
    } finally {
      setBusy(false);
    }
  };

  if (publicConfig.configError) {
    return (
      <Card className="border-rejected-fill/40">
        <CardHeader>
          <p className="kicker">Configuration</p>
          <CardTitle className="text-2xl">Mainnet refused</CardTitle>
          <CardDescription>{publicConfig.configError}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error && !vault) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-rejected">{error}</p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm text-accent underline-offset-4 hover:underline"
          >
            Back
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!vault) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const solSpend = spend.find((item) => item.mint === 'SOL' || item.mint === 'Sol');
  const isOwner = session.owner === vault.owner;
  const solLimit = vault.policy.perTxLimit.find((item) => item.mint.type === 'sol');
  const solCap = vault.policy.dailyCap.find((item) => item.mint.type === 'sol');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-accent underline-offset-4 hover:underline">
          All vaults
        </Link>
        <span className="font-mono text-xs text-muted-foreground">#{vaultId}</span>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="kicker">Vault</p>
              <CardTitle className="mt-2 text-2xl">Vault {vaultId}</CardTitle>
              <p className="mt-2 break-all font-mono text-sm">{vault.vaultAddress}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{vault.path}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <CopyButton value={vault.vaultAddress} label="Copy address" />
                <ProofLink value={vault.vaultAddress} kind="solana-address" />
              </div>
            </div>
            <div className="rounded-md bg-white p-2">
              <QRCodeSVG value={vault.vaultAddress} size={120} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={vault.paused ? 'danger' : 'ok'}>
              {vault.paused ? 'Paused' : vault.state}
            </StatusBadge>
            <StatusBadge tone="muted">
              SOL {balance === null ? '—' : `${lamportsToSol(balance)}`}
            </StatusBadge>
            <StatusBadge tone="muted">
              24h spend {solSpend ? `${lamportsToSol(solSpend.amount)} SOL` : '0 SOL'}
            </StatusBadge>
          </div>
          <SpendMeter
            perTxCap={solLimit ? lamportsToSol(solLimit.amount) : null}
            dailyUsed={solSpend ? lamportsToSol(solSpend.amount) : '0'}
            dailyCap={solCap ? lamportsToSol(solCap.amount) : null}
          />
          {!isOwner ? (
            <p className="text-sm text-muted-foreground">
              Read-only. Sign in with the owner wallet to change policy, agents, or the kill switch.
            </p>
          ) : null}
          <div>
            <ActionResult error={actionError} txHash={txHash} />
          </div>
        </CardContent>
      </Card>

      {isOwner ? (
        <Card className="border-rejected-fill/40">
          <CardHeader>
            <p className="kicker">Danger zone</p>
            <CardTitle>Kill switch</CardTitle>
            <CardDescription>
              Pause immediately stops new agent signatures for this vault. Unpause restores the
              current on-chain policy.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {vault.paused ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    ownerActionHelpers(session.owner!, session.signer!).unpause(vaultId)
                  )
                }
              >
                Unpause
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(() => ownerActionHelpers(session.owner!, session.signer!).pause(vaultId))
                }
              >
                Pause (kill switch)
              </Button>
            )}
            {vault.pendingLoosen ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    ownerActionHelpers(session.owner!, session.signer!).setPolicy(
                      vaultId,
                      clonePolicy(vault.policy)
                    )
                  )
                }
              >
                Cancel pending loosen
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <p className="kicker">Policy</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Enforced limits</CardTitle>
            {vault.pendingLoosen ? (
              <Countdown effectiveNs={vault.pendingLoosen.effectiveNs} />
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <PolicySummary policy={vault.policy} />
          {vault.pendingLoosen ? (
            <div className="mt-5 rounded-md border border-warning/30 bg-warning/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-warning">Pending loosen</strong>
                <Countdown effectiveNs={vault.pendingLoosen.effectiveNs} />
              </div>
              <p className="mt-2 text-xs text-warning">
                There is no dedicated cancel method. Re-submitting the current policy is treated as
                stricter and clears <code>pending_loosen</code> immediately. After the delay, anyone
                can call <code>apply_pending_policy</code> on-chain.
              </p>
              <div className="mt-3">
                <PolicySummary policy={vault.pendingLoosen.policy} />
              </div>
            </div>
          ) : null}
          {isOwner ? (
            <div className="mt-6">
              <Separator className="mb-5" />
              <PolicyEditor vaultId={vaultId} policy={vault.policy} onUpdated={() => void load()} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <RecipientsPanel vaultId={vaultId} recipients={recipients} onUpdated={() => void load()} />
      <AgentsPanel vaultId={vaultId} agents={vault.agents} onUpdated={() => void load()} />
      <ActivityFeed vaultId={vaultId} />
      <AttackLabPanel vaultId={vaultId} />
    </div>
  );
}
