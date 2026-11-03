'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Bot,
  Coins,
  Eye,
  Gauge,
  Power,
  QrCode,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type { Policy, VaultView } from '@sana-guard/sdk';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { publicConfig } from '@/lib/config';
import {
  formatDurationNs,
  formatTimestampNs,
  lamportsToSol,
  nsToDate,
  programLabel,
} from '@/lib/format';
import { clonePolicy, createViews, getSolanaBalanceLamports } from '@/lib/near';
import { ActionResult } from './action-result';
import { ActivityFeed } from './activity-feed';
import { AgentsPanel } from './agents-panel';
import { AttackLabPanel } from './attack-lab-panel';
import { PolicyEditor } from './policy-editor';
import { ProofLink } from './proof-link';
import { RecipientsPanel } from './recipients-panel';
import { SectionHeader } from './section-header';
import { StatTile, UsageBar } from './stat-tile';
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
        <dt className="text-xs text-muted-foreground">Max compute-unit price</dt>
        <dd className="font-mono">{policy.maxPriorityFeeLamports.toString()} lamports / CU</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Max total priority fee / tx</dt>
        <dd className="font-mono">
          {policy.maxTotalPriorityFeeLamports === undefined
            ? 'No cap'
            : `${lamportsToSol(policy.maxTotalPriorityFeeLamports)} SOL`}
        </dd>
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
              {programLabel(program)}
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

  const dailyUsed = solSpend ? solSpend.amount : 0n;
  const dailyPercent =
    solCap && solCap.amount > 0n ? Number((dailyUsed * 1000n) / solCap.amount) / 10 : 0;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-pill text-muted-foreground underline-offset-4 hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Vaults
        </Link>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <span className="font-medium">Vault {vaultId}</span>
      </nav>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Vault {vaultId}</h1>
            <StatusBadge tone={vault.paused ? 'danger' : 'ok'}>
              {vault.paused ? 'Paused' : vault.state}
            </StatusBadge>
            {vault.pendingLoosen ? <StatusBadge tone="warn">Pending loosen</StatusBadge> : null}
            {isOwner ? <StatusBadge tone="muted">You own this vault</StatusBadge> : null}
          </div>
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{vault.path}</p>
        </div>
        <ActionResult error={actionError} txHash={txHash} />
      </header>

      {!isOwner ? (
        <div className="flex items-start gap-3 rounded-lg border border-info/30 bg-info/[0.06] px-4 py-3 text-sm">
          <Eye aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Read-only view.</span> Sign in with the
            owner wallet to change policy, recipients, agents or the kill switch.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          icon={Coins}
          label="Vault balance"
          value={balance === null ? '—' : lamportsToSol(balance)}
          unit="SOL"
          hint="Solana devnet"
        />
        <StatTile
          icon={Gauge}
          label="Spent, rolling 24h"
          value={lamportsToSol(dailyUsed)}
          unit="SOL"
          hint={solCap ? `of ${lamportsToSol(solCap.amount)} SOL cap` : 'No SOL cap set'}
        >
          <UsageBar percent={dailyPercent} label="Rolling 24h SOL spend" />
        </StatTile>
        <StatTile
          icon={ShieldCheck}
          label="Per-transaction cap"
          value={solLimit ? lamportsToSol(solLimit.amount) : '—'}
          unit="SOL"
          hint="Larger transfers are rejected"
        />
        <StatTile
          icon={Bot}
          label="Agents"
          value={vault.agents.length}
          hint={vault.agents.length === 1 ? '1 function-call key' : 'Function-call keys'}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <SectionHeader
              icon={SlidersHorizontal}
              kicker="Policy"
              title="Enforced limits"
              action={
                vault.pendingLoosen ? (
                  <Countdown effectiveNs={vault.pendingLoosen.effectiveNs} />
                ) : undefined
              }
            />
            <CardContent>
              <PolicySummary policy={vault.policy} />
              {vault.pendingLoosen ? (
                <div className="mt-5 rounded-md border border-warning/30 bg-warning/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-warning">Pending loosen</strong>
                    <Countdown effectiveNs={vault.pendingLoosen.effectiveNs} />
                  </div>
                  <p className="mt-2 text-xs text-warning">
                    There is no dedicated cancel method. Re-submitting the current policy is treated
                    as stricter and clears <code>pending_loosen</code> immediately. After the delay,
                    anyone can call <code>apply_pending_policy</code> on-chain.
                  </p>
                  <div className="mt-3">
                    <PolicySummary policy={vault.pendingLoosen.policy} />
                  </div>
                </div>
              ) : null}
              {isOwner ? (
                <div className="mt-6">
                  <Separator className="mb-5" />
                  <PolicyEditor
                    vaultId={vaultId}
                    policy={vault.policy}
                    onUpdated={() => void load()}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <RecipientsPanel
            vaultId={vaultId}
            recipients={recipients}
            canEdit={isOwner}
            onUpdated={() => void load()}
          />
          <AgentsPanel
            vaultId={vaultId}
            agents={vault.agents}
            canEdit={isOwner}
            onUpdated={() => void load()}
          />
          <ActivityFeed vaultId={vaultId} />
          <AttackLabPanel vaultId={vaultId} />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-28">
          <Card>
            <SectionHeader icon={QrCode} kicker="Fund" title="Vault address" />
            <CardContent className="space-y-4">
              <div className="mx-auto w-fit rounded-md bg-white p-3">
                <QRCodeSVG value={vault.vaultAddress} size={156} />
              </div>
              <p className="break-all rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-xs leading-5">
                {vault.vaultAddress}
              </p>
              <ProofLink value={vault.vaultAddress} kind="solana-address" label="Address" />
              <p className="text-xs leading-5 text-muted-foreground">
                Derived by the NEAR MPC network for this vault and verified on-chain. Only the guard
                can sign for it.
              </p>
            </CardContent>
          </Card>

          {isOwner ? (
            <Card className={vault.paused ? 'border-border' : 'border-rejected-fill/40'}>
              <SectionHeader
                icon={Power}
                tone="danger"
                kicker="Danger zone"
                title="Kill switch"
                description={
                  vault.paused
                    ? 'New agent signatures are blocked. Unpause restores the current on-chain policy.'
                    : 'Pausing immediately stops new agent signatures for this vault.'
                }
              />
              <CardContent className="flex flex-col gap-2">
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
                    Unpause vault
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        ownerActionHelpers(session.owner!, session.signer!).pause(vaultId)
                      )
                    }
                  >
                    Pause vault
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
        </aside>
      </div>
    </div>
  );
}
