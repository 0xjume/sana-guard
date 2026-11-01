'use client';

import { useState } from 'react';
import { CreateVaultForm } from '@/components/create-vault-form';
import { MissingConfig } from '@/components/missing-config';
import { NetworkStatus } from '@/components/network-status';
import { VaultList } from '@/components/vault-list';
import { publicConfig } from '@/lib/config';

export default function HomePage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      {publicConfig.configError ? (
        <section className="panel border-rust-400/40">
          <p className="kicker">Configuration</p>
          <h1 className="mt-2 text-2xl font-semibold text-parchment-100">Mainnet refused</h1>
          <p className="mt-3 text-sm text-parchment-400">{publicConfig.configError}</p>
        </section>
      ) : null}
      {!publicConfig.privyAppId ? <MissingConfig /> : null}
      <section className="panel">
        <p className="kicker">Owner console</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight">
          Policy is on-chain. The dashboard only signs it.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-parchment-400">
          Sana Guard holds per-vault policy on NEAR and asks the MPC network to sign a Solana
          transaction only when an agent request passes that policy. This console is for owners:
          create a vault, tighten limits immediately, schedule loosenings, add agents, and hit the
          kill switch.
        </p>
      </section>
      <NetworkStatus />
      {publicConfig.configError ? null : (
        <>
          <VaultList refreshKey={refreshKey} />
          <CreateVaultForm onCreated={() => setRefreshKey((value) => value + 1)} />
        </>
      )}
    </div>
  );
}
