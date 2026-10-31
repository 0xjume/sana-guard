'use client';

import { useState } from 'react';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useInviteToken } from '@/hooks/use-invite-token';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { isBase58Pubkey } from '@/lib/policy-form';
import { ActionResult } from './action-result';
import type { GuardActionError } from '@/lib/errors';

export function RecipientsPanel({
  vaultId,
  recipients,
  onUpdated,
}: {
  vaultId: number;
  recipients: string[];
  onUpdated?: () => void;
}) {
  const session = useOwnerSession();
  const invite = useInviteToken();
  const [value, setValue] = useState('');
  const [ata, setAta] = useState('');
  const [mint, setMint] = useState('');
  const [decimals, setDecimals] = useState('6');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GuardActionError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const run = async (
    fn: () => Promise<{ success: boolean; txHash?: string; error?: GuardActionError }>
  ) => {
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      const result = await fn();
      if (result.success && result.txHash) {
        setTxHash(result.txHash);
        onUpdated?.();
      } else if (!result.success && result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Action failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <p className="kicker">Allowlists</p>
      <h2 className="mt-2 text-lg font-semibold">Recipients and token accounts</h2>
      <p className="mt-2 text-sm text-parchment-400">
        Adding a recipient is immediate on the current contract (not delayed). Removing is
        immediate. SPL transfers check the destination ATA, not just the wallet.
      </p>
      <ul className="mt-4 space-y-2">
        {recipients.length === 0 ? (
          <li className="text-sm text-parchment-400">No recipients.</li>
        ) : null}
        {recipients.map((recipient) => (
          <li
            key={recipient}
            className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-ink-600 px-3 py-2"
          >
            <span className="break-all font-mono text-xs">{recipient}</span>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy || !session.signer}
              onClick={() =>
                void run(() =>
                  ownerActionHelpers(session.owner!, session.signer!, invite.token).removeRecipient(
                    vaultId,
                    recipient
                  )
                )
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          className="field"
          placeholder="Solana address or ATA"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !isBase58Pubkey(value) || !session.signer}
          onClick={() =>
            void run(() =>
              ownerActionHelpers(session.owner!, session.signer!, invite.token).addRecipient(
                vaultId,
                value.trim()
              )
            )
          }
        >
          Add recipient
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <input
          className="field sm:col-span-2"
          placeholder="ATA"
          value={ata}
          onChange={(event) => setAta(event.target.value)}
        />
        <input
          className="field"
          placeholder="Mint"
          value={mint}
          onChange={(event) => setMint(event.target.value)}
        />
        <input
          className="field"
          placeholder="Decimals"
          value={decimals}
          onChange={(event) => setDecimals(event.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn-ghost mt-2"
        disabled={busy || !session.signer || !isBase58Pubkey(ata) || !isBase58Pubkey(mint)}
        onClick={() =>
          void run(() =>
            ownerActionHelpers(session.owner!, session.signer!, invite.token).registerTokenAccount(
              vaultId,
              ata.trim(),
              mint.trim(),
              Number(decimals)
            )
          )
        }
      >
        Register vault token account
      </button>
      <div className="mt-3">
        <ActionResult error={error} txHash={txHash} />
      </div>
    </section>
  );
}
