'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Policy, VaultView } from '@sana-guard/sdk';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useInviteToken } from '@/hooks/use-invite-token';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { publicConfig, solanaExplorerAddressUrl } from '@/lib/config';
import { formatDurationNs, formatTimestampNs, lamportsToSol, nsToDate } from '@/lib/format';
import { clonePolicy, createViews, getSolanaBalanceLamports } from '@/lib/near';
import { ActionResult } from './action-result';
import { ActivityFeed } from './activity-feed';
import { AgentsPanel } from './agents-panel';
import { AttackLabPanel } from './attack-lab-panel';
import { CopyButton } from './copy-button';
import { PolicyEditor } from './policy-editor';
import { RecipientsPanel } from './recipients-panel';
import { StatusBadge } from './status-badge';
import type { GuardActionError } from '@/lib/errors';

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
        <dt className="text-xs text-parchment-400">Per-tx SOL</dt>
        <dd className="font-mono">{solLimit ? `${lamportsToSol(solLimit.amount)} SOL` : '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-parchment-400">Rolling 24h SOL cap</dt>
        <dd className="font-mono">{solCap ? `${lamportsToSol(solCap.amount)} SOL` : '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-parchment-400">max_priority_fee_lamports</dt>
        <dd className="font-mono">{policy.maxPriorityFeeLamports.toString()}</dd>
      </div>
      <div>
        <dt className="text-xs text-parchment-400">max_total_priority_fee_lamports</dt>
        <dd className="font-mono">{policy.maxTotalPriorityFeeLamports?.toString() ?? 'none'}</dd>
      </div>
      <div>
        <dt className="text-xs text-parchment-400">Expiry</dt>
        <dd>{formatTimestampNs(policy.expiresAtNs)}</dd>
      </div>
      <div>
        <dt className="text-xs text-parchment-400">Loosen delay</dt>
        <dd>{formatDurationNs(policy.loosenDelayNs)}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs text-parchment-400">Programs</dt>
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
  const invite = useInviteToken();
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

  if (error && !vault) {
    return (
      <section className="panel">
        <p className="text-rust-400">{error}</p>
        <Link href="/" className="mt-3 inline-block text-sm text-brass-400 underline">
          Back
        </Link>
      </section>
    );
  }

  if (!vault) {
    return <section className="panel">Loading vault {vaultId}…</section>;
  }

  const solSpend = spend.find((item) => item.mint === 'SOL' || item.mint === 'Sol');
  const isOwner = session.owner === vault.owner;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-brass-400 underline">
          All vaults
        </Link>
        <span className="font-mono text-xs text-parchment-400">#{vaultId}</span>
      </div>

      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="kicker">Vault</p>
            <h1 className="mt-2 text-2xl font-semibold">Vault {vaultId}</h1>
            <p className="mt-2 break-all font-mono text-sm">{vault.vaultAddress}</p>
            <p className="mt-1 font-mono text-xs text-parchment-400">{vault.path}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <CopyButton value={vault.vaultAddress} label="Copy address" />
              <a
                className="btn-ghost"
                href={solanaExplorerAddressUrl(publicConfig.solanaRpcUrl, vault.vaultAddress)}
                target="_blank"
                rel="noreferrer"
              >
                Explorer
              </a>
            </div>
          </div>
          <div className="bg-white p-2">
            <QRCodeSVG value={vault.vaultAddress} size={120} />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
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
        {isOwner ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {vault.paused ? (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    ownerActionHelpers(session.owner!, session.signer!, invite.token).unpause(
                      vaultId
                    )
                  )
                }
              >
                Unpause
              </button>
            ) : (
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    ownerActionHelpers(session.owner!, session.signer!, invite.token).pause(vaultId)
                  )
                }
              >
                Pause (kill switch)
              </button>
            )}
            {vault.pendingLoosen ? (
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    ownerActionHelpers(session.owner!, session.signer!, invite.token).setPolicy(
                      vaultId,
                      clonePolicy(vault.policy)
                    )
                  )
                }
              >
                Cancel pending loosen
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-parchment-400">
            Read-only. Sign in with the owner wallet to change policy, agents, or the kill switch.
          </p>
        )}
        <div className="mt-4">
          <ActionResult error={actionError} txHash={txHash} />
        </div>
      </section>

      <section className="panel">
        <p className="kicker">Policy</p>
        <h2 className="mt-2 text-lg font-semibold">Enforced limits</h2>
        <div className="mt-4">
          <PolicySummary policy={vault.policy} />
        </div>
        {vault.pendingLoosen ? (
          <div className="notice-warn mt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>Pending loosen</strong>
              <Countdown effectiveNs={vault.pendingLoosen.effectiveNs} />
            </div>
            <p className="mt-2 text-xs">
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
          <div className="mt-6 border-t border-ink-600 pt-5">
            <PolicyEditor vaultId={vaultId} policy={vault.policy} onUpdated={() => void load()} />
          </div>
        ) : null}
      </section>

      <RecipientsPanel vaultId={vaultId} recipients={recipients} onUpdated={() => void load()} />
      <AgentsPanel vaultId={vaultId} agents={vault.agents} onUpdated={() => void load()} />
      <ActivityFeed vaultId={vaultId} />
      <AttackLabPanel vaultId={vaultId} />
    </div>
  );
}
