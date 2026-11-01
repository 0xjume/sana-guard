'use client';

import { useState } from 'react';
import { CreateVaultForm } from '@/components/create-vault-form';
import { GatewayLogin } from '@/components/gateway-login';
import { MissingConfig } from '@/components/missing-config';
import { NetworkStatus } from '@/components/network-status';
import { VaultList } from '@/components/vault-list';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { publicConfig } from '@/lib/config';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const session = useOwnerSession();
  const showGateway = Boolean(publicConfig.privyAppId) && !session.authenticated;

  return (
    <div className="space-y-6">
      {publicConfig.configError ? (
        <Card className="border-rejected-fill/40">
          <CardHeader>
            <p className="kicker">Configuration</p>
            <CardTitle className="text-2xl">Mainnet refused</CardTitle>
            <CardDescription>{publicConfig.configError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {!publicConfig.privyAppId ? <MissingConfig /> : null}
      {showGateway ? <GatewayLogin /> : null}
      {!showGateway ? (
        <Card>
          <CardHeader>
            <p className="kicker">Owner console</p>
            <CardTitle className="max-w-2xl text-3xl">
              Policy is on-chain. The dashboard only signs it.
            </CardTitle>
            <CardDescription className="max-w-2xl">
              Sana Guard holds per-vault policy on NEAR and asks the MPC network to sign a Solana
              transaction only when an agent request passes that policy. This console is for owners:
              create a vault, tighten limits immediately, schedule loosenings, add agents, and hit
              the kill switch.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      <NetworkStatus />
      {publicConfig.configError ? null : (
        <>
          {showGateway ? null : <VaultList refreshKey={refreshKey} />}
          <CreateVaultForm onCreated={() => setRefreshKey((value) => value + 1)} />
        </>
      )}
    </div>
  );
}
