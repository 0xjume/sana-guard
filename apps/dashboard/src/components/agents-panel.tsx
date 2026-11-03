'use client';

import { useEffect, useId, useState } from 'react';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import {
  DEFAULT_MAX_AGENT_GAS_FUNDING_NEAR,
  addAgentFundingHint,
  addAgentUiBlockedReason,
} from '@/lib/add-agent-limits';
import { publicConfig } from '@/lib/config';
import { fetchOwnerActionLimits, VAULT_LIMIT_UNAVAILABLE } from '@/lib/create-vault-limits';
import { nearToYocto } from '@/lib/format';
import { ActionResult } from './action-result';
import { AddressChip } from './address-chip';
import { ConfirmButton } from './confirm-button';
import { CopyButton } from './copy-button';
import type { GuardActionError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Bot } from 'lucide-react';
import { SectionHeader } from './section-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

function asActionError(err: unknown, fallback: string): GuardActionError {
  return { message: err instanceof Error ? err.message : fallback };
}

function agentCountLabel(count: number, max: number | null): string {
  if (max === null) {
    return String(count);
  }
  return `${count}/${max}`;
}

export function AgentsPanel({
  vaultId,
  agents,
  canEdit = false,
  onUpdated,
}: {
  vaultId: number;
  agents: string[];
  canEdit?: boolean;
  onUpdated?: () => void;
}) {
  const session = useOwnerSession();
  const fieldId = useId();
  const [name, setName] = useState('agent1');
  const [funding, setFunding] = useState('0.15');
  const [secret, setSecret] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [savedSecret, setSavedSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GuardActionError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [maxAgentsPerVault, setMaxAgentsPerVault] = useState<number | null>(null);
  const [maxFundingNear, setMaxFundingNear] = useState(DEFAULT_MAX_AGENT_GAS_FUNDING_NEAR);
  const minFundingNear = '0.15';
  const blockedReason =
    maxAgentsPerVault === null ? null : addAgentUiBlockedReason(agents.length, maxAgentsPerVault);
  const addDisabled =
    busy || !publicKey || !savedSecret || maxAgentsPerVault === null || Boolean(blockedReason);

  useEffect(() => {
    let cancelled = false;
    void fetchOwnerActionLimits()
      .then((limits) => {
        if (!cancelled) {
          setMaxAgentsPerVault(limits.maxAgentsPerVault);
          setMaxFundingNear(limits.maxAgentGasFundingNear);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(asActionError(err, VAULT_LIMIT_UNAVAILABLE));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = () => {
    const keypair = nacl.sign.keyPair();
    // Created in-memory only: never logged, never written to storage. The owner must copy it now.
    // near-api-js KeyPair.fromString (used by the MCP server) expects the ed25519: prefix.
    setSecret(`ed25519:${bs58.encode(Buffer.from(keypair.secretKey))}`);
    setPublicKey(`ed25519:${bs58.encode(Buffer.from(keypair.publicKey))}`);
    setSavedSecret(false);
  };

  const add = async () => {
    if (!session.owner || !session.signer || !publicKey || blockedReason) {
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
      setError(asActionError(err, 'AddAgent failed'));
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
      setError(asActionError(err, 'RemoveAgent failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionHeader
        icon={Bot}
        kicker="Agents"
        title="Agent accounts"
        description={
          <>
            Each agent gets its own NEAR account (
            <span className="font-mono">name.{publicConfig.guardContract}</span>) with a key that
            can only request signatures from this vault. The key is created in your browser and
            never sent to a server.
          </>
        }
        action={
          <span className="rounded-pill border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {agentCountLabel(agents.length, maxAgentsPerVault)}
          </span>
        }
      />
      <CardContent>
        {agents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No agents yet.
          </p>
        ) : (
          <Table>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent}>
                  <TableCell className="min-w-0">
                    <AddressChip value={agent} chain="near" />
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                      <ConfirmButton
                        disabled={busy}
                        title={`Remove ${agent}?`}
                        confirmLabel="Remove agent"
                        onConfirm={() => void remove(agent)}
                        description={
                          <>
                            <p>
                              This agent stops being able to request signatures from this vault
                              immediately.
                            </p>
                            <p>
                              Its NEAR account stays on-chain, so this name can't be added again. A
                              replacement agent needs a new name.
                            </p>
                          </>
                        }
                      >
                        Remove
                      </ConfirmButton>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {canEdit ? (
          <div className="mt-6 rounded-md border border-border bg-background/40 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-name`}>Name</Label>
                <Input
                  id={`${fieldId}-name`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-funding`}>
                  Gas funding ({minFundingNear}–{maxFundingNear} NEAR)
                </Label>
                <Input
                  id={`${fieldId}-funding`}
                  value={funding}
                  onChange={(event) => setFunding(event.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="outline" className="w-full" onClick={generate}>
                  Generate key
                </Button>
              </div>
            </div>
            {publicKey ? (
              <div className="mt-3 space-y-3 rounded-md border border-primary/30 bg-secondary p-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Public key (sent to the contract)</p>
                  <p className="mt-1 break-all font-mono">{publicKey}</p>
                </div>
                {secret ? (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
                    <p className="font-medium text-warning">
                      Agent secret key: save it now. It is not stored anywhere and can't be shown
                      again.
                    </p>
                    <p className="mt-2 break-all font-mono text-foreground">{secret}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <CopyButton value={secret} label="Copy secret key" />
                      <label className="flex min-h-11 items-center gap-2 text-foreground">
                        <input
                          type="checkbox"
                          checked={savedSecret}
                          onChange={(event) => setSavedSecret(event.target.checked)}
                        />
                        I've saved this key (NEAR_PRIVATE_KEY for the MCP server)
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {blockedReason ? (
              <p role="status" className="mt-4 text-sm text-muted-foreground">
                {blockedReason}
              </p>
            ) : null}
            <Button
              type="button"
              className="mt-4"
              disabled={addDisabled}
              onClick={() => void add()}
            >
              {busy ? 'Signing…' : addAgentFundingHint(minFundingNear, maxFundingNear)}
            </Button>
          </div>
        ) : null}
        <div className="mt-3">
          <ActionResult error={error} txHash={txHash} />
        </div>
      </CardContent>
    </Card>
  );
}
