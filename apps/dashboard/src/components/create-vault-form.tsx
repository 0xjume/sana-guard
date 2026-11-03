'use client';

import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { submittedSuccess } from '@/lib/action-result-state';
import { publicConfig } from '@/lib/config';
import {
  VAULT_LIMIT_UNAVAILABLE,
  createVaultUiBlockedReason,
  fetchOwnerActionLimits,
} from '@/lib/create-vault-limits';
import type { GuardActionError } from '@/lib/errors';
import { createViews } from '@/lib/near';
import { defaultCreatePolicyForm } from '@/lib/policy';
import { policyFromForm } from '@/lib/policy-form';
import { ActionResult } from './action-result';
import { AddressChip } from './address-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function asActionError(err: unknown, fallback: string): GuardActionError {
  return { message: err instanceof Error ? err.message : fallback };
}

async function ownerVaultCountFor(owner: string): Promise<number> {
  return createViews().getOwnerVaultCount(owner);
}

async function previewVaultAddress(owner: string, index: number): Promise<string> {
  const address = await createViews().deriveVaultAddress(
    publicConfig.mpcContract,
    owner,
    index,
    publicConfig.mpcDomainId
  );
  return address.toBase58();
}

export function CreateVaultForm({ onCreated }: { onCreated?: () => void }) {
  const session = useOwnerSession();
  const [busy, setBusy] = useState(false);
  const [derived, setDerived] = useState<string | null>(null);
  const [error, setError] = useState<GuardActionError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [ownerVaultCount, setOwnerVaultCount] = useState<number | null>(null);
  const [maxVaultsPerOwner, setMaxVaultsPerOwner] = useState<number | null>(null);
  const defaults = useMemo(() => defaultCreatePolicyForm(), []);

  useEffect(() => {
    let cancelled = false;
    void fetchOwnerActionLimits()
      .then((limits) => {
        if (!cancelled) {
          setMaxVaultsPerOwner(limits.maxVaultsPerOwner);
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

  useEffect(() => {
    if (!session.owner) {
      setOwnerVaultCount(null);
      return;
    }
    const owner = session.owner;
    let cancelled = false;
    void ownerVaultCountFor(owner)
      .then((count) => {
        if (!cancelled) {
          setOwnerVaultCount(count);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(asActionError(err, 'Failed to read owner vault count'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.owner]);

  if (!session.authenticated || !session.owner || !session.signer) {
    return null;
  }

  const owner = session.owner;
  const signer = session.signer;
  const blockedReason =
    ownerVaultCount === null || maxVaultsPerOwner === null
      ? null
      : createVaultUiBlockedReason(ownerVaultCount, maxVaultsPerOwner);
  const createDisabled =
    busy || ownerVaultCount === null || maxVaultsPerOwner === null || Boolean(blockedReason);

  async function derive(): Promise<void> {
    setError(null);
    const index = await ownerVaultCountFor(owner);
    setOwnerVaultCount(index);
    if (maxVaultsPerOwner !== null && createVaultUiBlockedReason(index, maxVaultsPerOwner)) {
      return;
    }
    setDerived(await previewVaultAddress(owner, index));
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      const index = await ownerVaultCountFor(owner);
      setOwnerVaultCount(index);
      const max = maxVaultsPerOwner ?? (await fetchOwnerActionLimits()).maxVaultsPerOwner;
      setMaxVaultsPerOwner(max);
      const blocked = createVaultUiBlockedReason(index, max);
      if (blocked) {
        setError({ code: 'DASH_VAULT_LIMIT', message: blocked });
        return;
      }
      const address = await previewVaultAddress(owner, index);
      setDerived(address);
      const result = await ownerActionHelpers(owner, signer).createVault(
        address,
        policyFromForm(defaults)
      );
      if (result.success) {
        setTxHash(result.txHash);
        setOwnerVaultCount(index + 1);
        onCreated?.();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(asActionError(err, 'Create vault failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <p className="kicker">Create</p>
        <CardTitle>New vault</CardTitle>
        <CardDescription>
          Sign in, create one vault (the relay pays ~0.5 NEAR storage + gas), set policy, add an
          agent key, then fund the vault Solana address. This hosted demo allows one vault per
          owner.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {blockedReason ? (
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            {blockedReason}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void derive()}
            disabled={createDisabled}
          >
            Preview address
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={createDisabled}>
            {busy ? 'Signing…' : 'Create vault'}
          </Button>
        </div>
        {derived ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-[160px_1fr] sm:items-center">
            <div className="w-fit rounded-md bg-white p-2">
              <QRCodeSVG value={derived} size={144} />
            </div>
            <div>
              <p className="kicker">Vault address</p>
              <div className="mt-2">
                <AddressChip value={derived} chain="solana" display="full" label="Address" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Fund this address on Solana devnet after creation. Default policy: 0.05 SOL / tx,
                0.1 SOL / 24h, System + ComputeBudget, priority fees capped at 0.001 SOL / tx, 1h
                loosen delay.
              </p>
            </div>
          </div>
        ) : null}
        <div className="mt-4">
          <ActionResult
            error={error}
            txHash={txHash}
            success={submittedSuccess(txHash, 'Vault created.')}
          />
        </div>
      </CardContent>
    </Card>
  );
}
