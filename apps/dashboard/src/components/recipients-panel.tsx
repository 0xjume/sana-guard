'use client';

import { useId, useState } from 'react';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { isBase58Pubkey } from '@/lib/policy-form';
import { ActionResult } from './action-result';
import type { GuardActionError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

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
  const fieldId = useId();
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
    <Card>
      <CardHeader>
        <p className="kicker">Allowlists</p>
        <CardTitle>Recipients and token accounts</CardTitle>
        <CardDescription>
          Adding a recipient is immediate on the current contract (not delayed). Removing is
          immediate. SPL transfers check the destination ATA, not just the wallet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recipients.</p>
        ) : (
          <Table>
            <TableBody>
              {recipients.map((recipient) => (
                <TableRow key={recipient}>
                  <TableCell className="break-all font-mono text-xs">{recipient}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || !session.signer}
                      onClick={() =>
                        void run(() =>
                          ownerActionHelpers(session.owner!, session.signer!).removeRecipient(
                            vaultId,
                            recipient
                          )
                        )
                      }
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor={`${fieldId}-address`}>Solana address or ATA</Label>
            <Input
              id={`${fieldId}-address`}
              placeholder="Solana address or ATA"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={busy || !isBase58Pubkey(value) || !session.signer}
            onClick={() =>
              void run(() =>
                ownerActionHelpers(session.owner!, session.signer!).addRecipient(
                  vaultId,
                  value.trim()
                )
              )
            }
          >
            Add recipient
          </Button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${fieldId}-ata`}>ATA</Label>
            <Input
              id={`${fieldId}-ata`}
              placeholder="ATA"
              value={ata}
              onChange={(event) => setAta(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-mint`}>Mint</Label>
            <Input
              id={`${fieldId}-mint`}
              placeholder="Mint"
              value={mint}
              onChange={(event) => setMint(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-decimals`}>Decimals</Label>
            <Input
              id={`${fieldId}-decimals`}
              placeholder="Decimals"
              value={decimals}
              onChange={(event) => setDecimals(event.target.value)}
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-2"
          disabled={busy || !session.signer || !isBase58Pubkey(ata) || !isBase58Pubkey(mint)}
          onClick={() =>
            void run(() =>
              ownerActionHelpers(session.owner!, session.signer!).registerTokenAccount(
                vaultId,
                ata.trim(),
                mint.trim(),
                Number(decimals)
              )
            )
          }
        >
          Register vault token account
        </Button>
        <div className="mt-3">
          <ActionResult error={error} txHash={txHash} />
        </div>
      </CardContent>
    </Card>
  );
}
