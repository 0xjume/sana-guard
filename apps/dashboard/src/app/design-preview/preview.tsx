'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AttackAttemptCard } from '@/components/attack-attempt-card';
import { OwnerSignInCard } from '@/components/gateway-login';
import { PolicyVerdict } from '@/components/policy-verdict';
import { ProofLink } from '@/components/proof-link';
import { ConfirmButton } from '@/components/confirm-button';
import { useSignReview } from '@/components/sign-review';
import { SpendMeter } from '@/components/spend-meter';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const MOCK_TX = '8x7kQ2n4mP9rL1cD6fH3jS5tV0wY8zA2bC4dE6fG8hJ';
const MOCK_SOL = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';

const SAMPLE_ADMIN_MESSAGE = [
  'SANA-GUARD-ADMIN-v1',
  'network: near-testnet',
  'contract: guard.djume.testnet',
  'vault: 0',
  'nonce: 7',
  'expires: 1800000000000000000',
  'action: {"type":"SetPolicy","vault_id":0,"policy":{"per_tx_limit":[["Sol","50000000"]],"daily_cap":[["Sol","100000000"]],"programs":["11111111111111111111111111111111","ComputeBudget111111111111111111111111111111"],"max_priority_fee_lamports":"100000","max_memo_len":64,"expires_at_ns":"1800000000000000000","loosen_delay_ns":"3600000000000"}}',
].join('\n');

function SignReviewSample() {
  const review = useSignReview();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review before signing</CardTitle>
        <CardDescription>
          Opens the dialog the owner sees before every wallet signature (sample SetPolicy without a
          total fee cap).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" onClick={() => void review(SAMPLE_ADMIN_MESSAGE)}>
          Open sign review
        </Button>
      </CardContent>
    </Card>
  );
}

function PreviewTabs() {
  const params = useSearchParams();
  const tab = params.get('tab') ?? 'policy';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <p className="kicker">Design preview</p>
          <CardTitle as="h1">Presentational mocks</CardTitle>
          <CardDescription>
            Static samples only. No Privy session, NEAR views, or owner-action / attack-lab calls.
          </CardDescription>
        </CardHeader>
      </Card>
      <Tabs defaultValue={tab}>
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="policy">Policy</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="attack">Attack lab</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="signin">Sign-in</TabsTrigger>
          <TabsTrigger value="sign-review">Sign review</TabsTrigger>
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
          <Card>
            <CardHeader>
              <p className="kicker">Allowlists</p>
              <CardTitle>Recipients and token accounts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="break-all font-mono text-xs">{MOCK_SOL}</p>
              <div className="space-y-2">
                <Label>Solana address or ATA</Label>
                <Input readOnly value="" placeholder="Solana address or ATA" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="agents">
          <Card>
            <CardHeader>
              <p className="kicker">Agents</p>
              <CardTitle>Function-call identities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs">agent1.guard.djume.testnet</p>
                <ConfirmButton
                  title="Remove agent1.guard.djume.testnet?"
                  confirmLabel="Remove agent"
                  onConfirm={() => undefined}
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
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="preview-agent-name">Name</Label>
                  <Input id="preview-agent-name" readOnly value="agent1" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="preview-agent-funding">Gas funding (NEAR)</Label>
                  <Input id="preview-agent-funding" readOnly value="0.15" />
                </div>
              </div>
            </CardContent>
          </Card>
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
                  },
                },
              ],
            }}
          />
          <Card>
            <CardHeader>
              <p className="kicker">Attack lab</p>
              <CardTitle>Policy-violating agent requests</CardTitle>
              <CardDescription>Buttons are inert in this preview.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="outline" disabled>
                Over per-tx limit
              </Button>
              <Button type="button" variant="outline" disabled>
                Non-allowlisted recipient
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="config">
          <Card className="border-warning/40">
            <CardHeader>
              <p className="kicker">Configuration</p>
              <CardTitle className="text-2xl">Missing Privy app ID</CardTitle>
              <CardDescription>
                Static mock of the configuration card. The live dashboard reads env vars; this
                preview does not.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="warning">NEXT_PUBLIC_PRIVY_APP_ID unset</Badge>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="signin">
          <OwnerSignInCard />
        </TabsContent>
        <TabsContent value="sign-review">
          <SignReviewSample />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function DesignPreview() {
  return (
    <Suspense>
      <PreviewTabs />
    </Suspense>
  );
}
