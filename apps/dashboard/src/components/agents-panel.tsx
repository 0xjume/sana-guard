'use client';

import { useState } from 'react';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { nearToYocto } from '@/lib/format';
import { ActionResult } from './action-result';
import type { GuardActionError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

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
    <Card>
      <CardHeader>
        <p className="kicker">Agents</p>
        <CardTitle>Function-call identities</CardTitle>
        <CardDescription>
          AddAgent creates{' '}
          <code>
            {'{name}.'}
            {'{guard}'}
          </code>{' '}
          with one FC key. The secret is generated in this browser and shown once — it is not sent
          to the dashboard server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents yet.</p>
        ) : (
          <Table>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent}>
                  <TableCell className="font-mono text-xs">{agent}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void remove(agent)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input id="agent-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-funding">Gas funding (NEAR)</Label>
            <Input
              id="agent-funding"
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
          <div className="mt-3 rounded-md border border-primary/30 bg-secondary p-3 text-xs">
            <p className="text-muted-foreground">Public key (submitted)</p>
            <p className="mt-1 break-all font-mono">{publicKey}</p>
            {secret ? (
              <>
                <p className="mt-3 text-rejected">Secret (shown once, copy now)</p>
                <p className="mt-1 break-all font-mono">{secret}</p>
              </>
            ) : null}
          </div>
        ) : null}
        <Button
          type="button"
          className="mt-4"
          disabled={busy || !publicKey}
          onClick={() => void add()}
        >
          {busy ? 'Signing…' : 'Add agent (≥ 0.15 NEAR)'}
        </Button>
        <div className="mt-3">
          <ActionResult error={error} txHash={txHash} />
        </div>
      </CardContent>
    </Card>
  );
}
