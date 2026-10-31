'use client';

import { useState } from 'react';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { nearToYocto } from '@/lib/format';
import { ActionResult } from './action-result';
import type { GuardActionError } from '@/lib/errors';

export function AgentsPanel({
  vaultId,
  agents,
  onUpdated,
}: {
  vaultId: number;
  agents: string[];
  onUpdated?: () => void;
}) {
  const session = useOwnerSession();
  const [name, setName] = useState('agent1');
  const [funding, setFunding] = useState('0.15');
  const [secret, setSecret] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GuardActionError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const generate = () => {
    const keypair = nacl.sign.keyPair();
    setSecret(bs58.encode(Buffer.from(keypair.secretKey)));
    setPublicKey(`ed25519:${bs58.encode(Buffer.from(keypair.publicKey))}`);
  };

  const add = async () => {
    if (!session.owner || !session.signer || !publicKey) {
      return;
    }
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      const result = await ownerActionHelpers(session.owner, session.signer).addAgent(
        vaultId,
        name.trim(),
        publicKey,
        nearToYocto(funding)
      );
      if (result.success) {
        setTxHash(result.txHash);
        onUpdated?.();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'AddAgent failed' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (agent: string) => {
    if (!session.owner || !session.signer) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await ownerActionHelpers(session.owner, session.signer).removeAgent(
        vaultId,
        agent
      );
      if (result.success) {
        setTxHash(result.txHash);
        onUpdated?.();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'RemoveAgent failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <p className="kicker">Agents</p>
      <h2 className="mt-2 text-lg font-semibold">Function-call identities</h2>
      <p className="mt-2 text-sm text-parchment-400">
        AddAgent creates{' '}
        <code>
          {'{name}.'}
          {'{guard}'}
        </code>{' '}
        with one FC key. The secret is generated in this browser and shown once — it is not sent to
        the dashboard server.
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {agents.length === 0 ? <li className="text-parchment-400">No agents yet.</li> : null}
        {agents.map((agent) => (
          <li
            key={agent}
            className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-ink-600 px-3 py-2"
          >
            <span className="font-mono text-xs">{agent}</span>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void remove(agent)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs">
          Name
          <input
            className="field mt-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="text-xs">
          Gas funding (NEAR)
          <input
            className="field mt-1"
            value={funding}
            onChange={(event) => setFunding(event.target.value)}
          />
        </label>
        <div className="flex items-end">
          <button type="button" className="btn-ghost w-full" onClick={generate}>
            Generate key
          </button>
        </div>
      </div>
      {publicKey ? (
        <div className="mt-3 rounded-sm border border-brass-500/30 bg-ink-800 p-3 text-xs">
          <p className="text-parchment-400">Public key (submitted)</p>
          <p className="mt-1 break-all font-mono">{publicKey}</p>
          {secret ? (
            <>
              <p className="mt-3 text-rust-400">Secret (shown once, copy now)</p>
              <p className="mt-1 break-all font-mono">{secret}</p>
            </>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className="btn-primary mt-4"
        disabled={busy || !publicKey}
        onClick={() => void add()}
      >
        {busy ? 'Signing…' : 'Add agent (≥ 0.15 NEAR)'}
      </button>
      <div className="mt-3">
        <ActionResult error={error} txHash={txHash} />
      </div>
    </section>
  );
}
