'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AttackAttemptCard } from '@/components/attack-attempt-card';
import { MissingConfig } from '@/components/missing-config';
import { PolicyVerdict } from '@/components/policy-verdict';
import { ProofLink } from '@/components/proof-link';
import { SpendMeter } from '@/components/spend-meter';
import { StatusBadge } from '@/components/status-badge';
import { AgentsPanel } from '@/components/agents-panel';
import { RecipientsPanel } from '@/components/recipients-panel';
import { AttackLabPanel } from '@/components/attack-lab-panel';
import { GatewayLogin } from '@/components/gateway-login';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const MOCK_TX = '8x7kQ2n4mP9rL1cD6fH3jS5tV0wY8zA2bC4dE6fG8hJ';
const MOCK_SOL = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';

function DesignPreview() {
  const params = useSearchParams();
  const tab = params.get('tab') ?? 'policy';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <p className="kicker">Design preview</p>
          <CardTitle>Mocked dashboard states</CardTitle>
        </CardHeader>
      </Card>
      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="policy">Policy</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="attack">Attack lab</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="gateway">Gateway</TabsTrigger>
        </TabsList>
        <TabsContent value="policy" className="space-y-4">
          <PolicyVerdict
            verdict="rejected"
            code="SG_E062_PER_TX_LIMIT_EXCEEDED"
            expected="50000000"
            actual="50000001"
          >
            <ProofLink value={MOCK_TX} kind="near-tx" />
          </PolicyVerdict>
          <PolicyVerdict verdict="allowed">
            <ProofLink value={MOCK_TX} kind="near-tx" finalized />
          </PolicyVerdict>
          <Card>
            <CardHeader>
              <p className="kicker">Vault</p>
              <CardTitle>Vault 0</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="ok">Active</StatusBadge>
                <StatusBadge tone="warn">Pending loosen</StatusBadge>
                <ProofLink value={MOCK_SOL} kind="solana-address" />
              </div>
              <SpendMeter perTxCap="0.05" dailyUsed="0.09" dailyCap="0.1" />
            </CardContent>
          </Card>
          <RecipientsPanel vaultId={0} recipients={[MOCK_SOL]} />
        </TabsContent>
        <TabsContent value="agents">
          <AgentsPanel vaultId={0} agents={['agent1.guard.djume.testnet']} />
        </TabsContent>
        <TabsContent value="attack" className="space-y-4">
          <AttackAttemptCard
            result={{
              enabled: true,
              kind: 'over_per_tx_limit',
              expected: 'SG_E062_PER_TX_LIMIT_EXCEEDED',
              evaluated: 'SG_E062_PER_TX_LIMIT_EXCEEDED',
              vaultId: 0,
              attempts: [
                {
                  pass: 1,
                  result: {
                    code: 'SG_E062_PER_TX_LIMIT_EXCEEDED',
                    message: 'Per-transaction limit exceeded',
                    txHash: MOCK_TX,
                  },
                },
              ],
            }}
          />
          <AttackLabPanel vaultId={0} />
        </TabsContent>
        <TabsContent value="config">
          <MissingConfig />
        </TabsContent>
        <TabsContent value="gateway">
          <GatewayLogin />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function DesignPreviewPage() {
  return (
    <Suspense>
      <DesignPreview />
    </Suspense>
  );
}
