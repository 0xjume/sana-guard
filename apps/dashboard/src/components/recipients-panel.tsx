'use client';

import { useId, useState } from 'react';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { isBase58Pubkey } from '@/lib/policy-form';
import { ActionResult } from './action-result';
import { ConfirmButton } from './confirm-button';
import type { GuardActionError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { ListChecks } from 'lucide-react';
import { SectionHeader } from './section-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

export function RecipientsPanel({
  vaultId,
  recipients,
  canEdit = false,
  onUpdated,
}: {
  vaultId: number;
  recipients: string[];
  canEdit?: boolean;
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
      <SectionHeader
        icon={ListChecks}
        kicker="Allowlists"
        title="Recipients and token accounts"
        description="Adding or removing a recipient takes effect immediately. SPL transfers check the destination ATA, not just the wallet."
        action={
          <span className="rounded-pill border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {recipients.length}
          </span>
        }
      />
      <CardContent>
        {recipients.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No recipients yet. Agents cannot send anywhere until one is allowlisted.
          </p>
        ) : (
          <Table>
            <TableBody>
              {recipients.map((recipient) => (
                <TableRow key={recipient}>
                  <TableCell className="break-all font-mono text-xs">{recipient}</TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                      <ConfirmButton
                        disabled={busy || !session.signer}
                        title="Remove this recipient?"
                        confirmLabel="Remove recipient"
                        onConfirm={() =>
                          void run(() =>
                            ownerActionHelpers(session.owner!, session.signer!).removeRecipient(
                              vaultId,
                              recipient
                            )
                          )
                        }
                        description={
                          <>
                            <p className="break-all font-mono text-xs text-foreground">
                              {recipient}
                            </p>
                            <p>
                              Agents can no longer pay this address, starting immediately. You can
                              add it back later.
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
          <div className="mt-6 space-y-5 rounded-md border border-border bg-background/40 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
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
            <div className="grid gap-2 sm:grid-cols-4">
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
          </div>
        ) : null}
        <div className="mt-3">
          <ActionResult error={error} txHash={txHash} />
        </div>
      </CardContent>
    </Card>
  );
}
