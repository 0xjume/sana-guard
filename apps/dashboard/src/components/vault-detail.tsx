'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  formatSol,
  formatTimestampNs,
  nsToDate,
  programLabel,
  solExactTitle,
  worstCasePriorityFeeLamports,
} from '@/lib/format';
import { clonePolicy } from '@/lib/near';
import { ownerCanEdit } from '@/lib/owner-can-edit';
import {
  GENERIC_VAULT_LOAD_ERROR,
  applyClientVaultRefresh,
  deserializeVaultSnapshot,
  loadVaultSnapshot,
  type SerializedVaultSnapshot,
} from '@/lib/vault-snapshot';
import { ActionResult } from './action-result';
import { ActivityFeed } from './activity-feed';
import { AddressChip } from './address-chip';
import { AgentsPanel } from './agents-panel';
import { AttackLabPanel } from './attack-lab-panel';
import { PolicyEditor } from './policy-editor';
import { RecipientsPanel } from './recipients-panel';
import { CopyButton } from './copy-button';
import { LoadError } from './load-error';
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
    return <StatusBadge tone="ok">Delay passed · ready to apply</StatusBadge>;
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

/**
 * The owner signs with a Solana wallet and has no NEAR account in this app, so applying a due
 * loosening (a permissionless contract call) is done from any NEAR account with the CLI.
 */
function ApplyPendingHelp({ vaultId }: { vaultId: number }) {
  const command = `near contract call-function as-transaction ${publicConfig.guardContract} apply_pending_policy json-args '{"vault_id":${vaultId}}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <your-account> network-config ${publicConfig.nearNetwork} sign-with-keychain send`;
  return (
    <details className="mt-3 rounded-md border border-warning/30 bg-background/40 text-xs">
      <summary className="cursor-pointer px-3 py-2 text-foreground">How to apply it</summary>
      <div className="space-y-2 border-t border-warning/20 px-3 py-3 text-muted-foreground">
        <p>
          Once the delay has passed, anyone can apply it from any NEAR account (it costs a little
          gas and changes nothing before the delay ends):
        </p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-secondary p-2 font-mono text-[11px] text-foreground">
          {command}
        </pre>
        <CopyButton value={command} label="Copy command" />
      </div>
    </details>
  );
}

function PolicySummary({ policy }: { policy: Policy }) {
  const solLimit = policy.perTxLimit.find((item) => item.mint.type === 'sol');
  const solCap = policy.dailyCap.find((item) => item.mint.type === 'sol');
  return (
    <div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Per-tx SOL</dt>
          <dd className="font-mono" title={solLimit ? solExactTitle(solLimit.amount) : undefined}>
            {solLimit ? formatSol(solLimit.amount) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Rolling 24h SOL cap</dt>
          <dd className="font-mono" title={solCap ? solExactTitle(solCap.amount) : undefined}>
            {solCap ? formatSol(solCap.amount) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Max compute-unit price</dt>
          <dd className="font-mono">{policy.maxPriorityFeeLamports.toString()} lamports / CU</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Max total priority fee / tx</dt>
          <dd
            className="font-mono"
            title={
              policy.maxTotalPriorityFeeLamports === undefined
                ? undefined
                : solExactTitle(policy.maxTotalPriorityFeeLamports)
            }
          >
            {policy.maxTotalPriorityFeeLamports === undefined
              ? 'No cap'
              : formatSol(policy.maxTotalPriorityFeeLamports)}
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
      {policy.maxTotalPriorityFeeLamports === undefined && policy.maxPriorityFeeLamports > 0n ? (
        <p className="mt-4 flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          No total priority fee cap. One transaction may pay up to{' '}
          {formatSol(worstCasePriorityFeeLamports(policy.maxPriorityFeeLamports))} in priority fees.
        </p>
      ) : null}
    </div>
  );
}

export function VaultDetail({
  vaultId,
  initialSnapshot,
}: {
  vaultId: number;
  initialSnapshot?: SerializedVaultSnapshot;
}) {
  const session = useOwnerSession();
  const initial = initialSnapshot ? deserializeVaultSnapshot(initialSnapshot) : null;
  const [vault, setVault] = useState<VaultView | null>(initial?.vault ?? null);
  const [recipients, setRecipients] = useState<string[]>(initial?.recipients ?? []);
  const [spend, setSpend] = useState<Array<{ mint: string; amount: bigint }>>(initial?.spend ?? []);
  const [balance, setBalance] = useState<bigint | null>(initial?.balance ?? null);
  const [error, setError] = useState<string | null>(
    initial?.status === 'error' ? (initial.error ?? GENERIC_VAULT_LOAD_ERROR) : null
  );
  const [actionError, setActionError] = useState<GuardActionError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paintedRef = useRef(Boolean(initial?.vault));

  const load = useCallback(async () => {
    try {
      const snapshot = await loadVaultSnapshot(vaultId);
      const decision = applyClientVaultRefresh({
        hasPaintedVault: paintedRef.current,
        snapshot,
      });
      if (decision.replace && snapshot.vault) {
        setVault(snapshot.vault);
        setRecipients(snapshot.recipients ?? []);
        setSpend(snapshot.spend ?? []);
        setBalance(snapshot.balance ?? null);
        setError(null);
        paintedRef.current = true;
        return;
      }
      if (decision.clearPainted) {
        setVault(null);
        setError(decision.error);
        paintedRef.current = false;
      }
    } catch (err) {
      console.error('vault-detail load', err);
      if (!paintedRef.current) {
        setError(GENERIC_VAULT_LOAD_ERROR);
      }
    }
  }, [vaultId]);

  const reload = useCallback(() => {
    if (!paintedRef.current) {
      setError(null);
    }
    void load();
  }, [load]);

  useEffect(() => {
    void load();
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
      <div className="space-y-4">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-pill pr-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          All vaults
        </Link>
        {error === 'Vault not found' ? (
          <Card>
            <CardContent className="p-6">
              <h1 className="font-heading text-2xl font-semibold">Vault {vaultId} not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                No vault with this number exists on {publicConfig.guardContract}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <LoadError
            title={`Couldn't load vault ${vaultId}`}
            detail={`${error}. The network may be slow; your vault and its policy are unaffected.`}
            onRetry={reload}
          />
        )}
      </div>
    );
  }

  if (!vault) {
    return (
      <div className="space-y-6" aria-busy="true">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          Vault {vaultId}
        </h1>
        <p className="sr-only" role="status">
          Loading vault {vaultId}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Skeleton className="h-[7.5rem] w-full rounded-lg" />
          <Skeleton className="h-[7.5rem] w-full rounded-lg" />
          <Skeleton className="h-[7.5rem] w-full rounded-lg" />
          <Skeleton className="h-[7.5rem] w-full rounded-lg" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const solSpend = spend.find((item) => item.mint === 'SOL' || item.mint === 'Sol');
  const sessionReady = session.ready;
  const canEdit = ownerCanEdit(session, vault.owner);
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
          className="inline-flex min-h-11 items-center gap-1.5 rounded-pill pr-2 text-muted-foreground underline-offset-4 hover:text-foreground"
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
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              Vault {vaultId}
            </h1>
            <StatusBadge tone={vault.paused ? 'danger' : 'ok'}>
              {vault.paused ? 'Paused' : vault.state}
            </StatusBadge>
            {vault.pendingLoosen ? <StatusBadge tone="warn">Pending loosen</StatusBadge> : null}
            {canEdit ? <StatusBadge tone="muted">You own this vault</StatusBadge> : null}
          </div>
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{vault.path}</p>
        </div>
        <ActionResult error={actionError} txHash={txHash} />
      </header>

      {sessionReady && !canEdit ? (
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
          value={balance === null ? '—' : formatSol(balance, { unit: false })}
          unit="SOL"
          hint="Solana devnet"
        />
        <StatTile
          icon={Gauge}
          label="Spent, rolling 24h"
          value={formatSol(dailyUsed, { unit: false })}
          unit="SOL"
          hint={solCap ? `of ${formatSol(solCap.amount)} cap` : 'No SOL cap set'}
        >
          <UsageBar percent={dailyPercent} label="Rolling 24h SOL spend" />
        </StatTile>
        <StatTile
          icon={ShieldCheck}
          label="Per-transaction cap"
          value={solLimit ? formatSol(solLimit.amount, { unit: false }) : '—'}
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
                    <strong className="text-warning">Looser policy scheduled</strong>
                    <Countdown effectiveNs={vault.pendingLoosen.effectiveNs} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-warning">
                    The limits below take effect only after the delay, and only once someone applies
                    them on-chain. Until then the current limits stay in force. To cancel, use
                    “Cancel pending loosen” in the kill-switch panel.
                  </p>
                  <ApplyPendingHelp vaultId={vaultId} />
                  <div className="mt-3">
                    <PolicySummary policy={vault.pendingLoosen.policy} />
                  </div>
                </div>
              ) : null}
              {canEdit ? (
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
            canEdit={canEdit}
            onUpdated={() => void load()}
          />
          <AgentsPanel
            vaultId={vaultId}
            agents={vault.agents}
            canEdit={canEdit}
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
              <AddressChip
                value={vault.vaultAddress}
                chain="solana"
                display="full"
                label="Address"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Derived by the NEAR MPC network for this vault and verified on-chain. Only the guard
                can sign for it.
              </p>
            </CardContent>
          </Card>

          {canEdit ? (
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
                    variant="outline"
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
