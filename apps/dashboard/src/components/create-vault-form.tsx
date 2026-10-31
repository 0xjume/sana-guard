'use client';

import { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { publicConfig, solanaExplorerAddressUrl } from '@/lib/config';
import { createViews } from '@/lib/near';
import { defaultCreatePolicyForm } from '@/lib/policy';
import { policyFromForm } from '@/lib/policy-form';
import { ActionResult } from './action-result';
import type { GuardActionError } from '@/lib/errors';

export function CreateVaultForm({ onCreated }: { onCreated?: () => void }) {
  const session = useOwnerSession();
  const [busy, setBusy] = useState(false);
  const [derived, setDerived] = useState<string | null>(null);
  const [error, setError] = useState<GuardActionError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const defaults = useMemo(() => defaultCreatePolicyForm(), []);

  if (!session.authenticated || !session.owner || !session.signer) {
    return null;
  }

  const derive = async () => {
    setError(null);
    const views = createViews();
    const index = await views.getOwnerVaultCount(session.owner!);
    const address = await views.deriveVaultAddress(
      publicConfig.mpcContract,
      session.owner!,
      index,
      publicConfig.mpcDomainId
    );
    setDerived(address.toBase58());
  };

  const submit = async () => {
    if (!session.owner || !session.signer) {
      return;
    }
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      const views = createViews();
      const index = await views.getOwnerVaultCount(session.owner);
      const address = await views.deriveVaultAddress(
        publicConfig.mpcContract,
        session.owner,
        index,
        publicConfig.mpcDomainId
      );
      setDerived(address.toBase58());
      const policy = policyFromForm(defaults);
      const result = await ownerActionHelpers(session.owner, session.signer).createVault(
        address.toBase58(),
        policy
      );
      if (result.success) {
        setTxHash(result.txHash);
        onCreated?.();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Create vault failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <p className="kicker">Create</p>
      <h2 className="mt-2 text-lg font-semibold">New vault</h2>
      <p className="mt-2 text-sm text-parchment-400">
        Derives the next MPC Solana address for this owner, then submits a signed{' '}
        <code>CreateVault</code> through the relay (0.5 NEAR storage, paid by the relay).
        CreateVault is invite-gated on the public relay. This app attaches <code>INVITE_TOKEN</code>{' '}
        on the server; it is never shipped to the browser.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" onClick={() => void derive()} disabled={busy}>
          Preview address
        </button>
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Signing…' : 'Create vault'}
        </button>
      </div>
      {derived ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-[160px_1fr] sm:items-center">
          <div className="w-fit bg-white p-2">
            <QRCodeSVG value={derived} size={144} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-parchment-400">Vault address</p>
            <p className="mt-1 break-all font-mono text-sm">{derived}</p>
            <a
              className="mt-2 inline-block text-xs text-brass-400 underline"
              href={solanaExplorerAddressUrl(publicConfig.solanaRpcUrl, derived)}
              target="_blank"
              rel="noreferrer"
            >
              Solana explorer
            </a>
            <p className="mt-3 text-xs text-parchment-400">
              Fund this address on Solana devnet after creation. Default policy: 0.05 SOL / tx, 0.1
              SOL / 24h, System + ComputeBudget, 1h loosen delay.
            </p>
          </div>
        </div>
      ) : null}
      <div className="mt-4">
        <ActionResult error={error} txHash={txHash} success="Vault created." />
      </div>
    </section>
  );
}
