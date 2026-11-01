import { ShieldX } from 'lucide-react';
import { ATTACK_LABELS, type AttackKind } from '@/lib/attack-lab';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PolicyVerdict } from '@/components/policy-verdict';
import { ProofLink } from '@/components/proof-link';

export interface AttackLabResult {
  enabled?: boolean;
  kind?: string;
  expected?: string;
  evaluated?: string;
  vaultId?: number;
  error?: string;
  attempts?: Array<{
    pass: number;
    result: {
      message?: string;
      code?: string;
      unexpected?: string;
      txHash?: string;
    };
  }>;
}

function isAttackKind(value: string | undefined): value is AttackKind {
  return Boolean(value && value in ATTACK_LABELS);
}

export function AttackAttemptCard({ result }: { result: AttackLabResult }) {
  const kindLabel = isAttackKind(result.kind) ? ATTACK_LABELS[result.kind] : result.kind;
  const attempt = result.attempts?.[0]?.result;
  const code = attempt?.code ?? result.evaluated;
  const txHash = attempt?.txHash;
  const rejected = !attempt?.unexpected;

  return (
    <Card className="border-rejected-fill/30">
      <CardHeader className="gap-3">
        <p className="kicker">Attack attempt</p>
        <div className="flex flex-wrap items-center gap-2">
          <ShieldX className="h-5 w-5 text-rejected" aria-hidden />
          <CardTitle className="text-lg">{kindLabel ?? 'Policy probe'}</CardTitle>
          {result.kind ? <Badge variant="muted">{result.kind}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3 border-l border-divider pl-4">
          <li>
            <p className="text-xs font-medium text-muted-foreground">1. Attack</p>
            <p className="mt-1 text-sm">{kindLabel ?? 'Submitted a policy-violating request'}</p>
          </li>
          <li>
            <p className="text-xs font-medium text-muted-foreground">2. Policy check</p>
            <p className="mt-1 font-mono text-xs">
              expected {result.expected ?? '—'} → evaluated {result.evaluated ?? '—'}
            </p>
          </li>
          <li>
            <p className="text-xs font-medium text-muted-foreground">3. On-chain</p>
            <p className="mt-1 text-sm">
              {attempt?.unexpected ?? attempt?.message ?? result.error ?? 'Rejected on-chain'}
            </p>
          </li>
        </ol>
        {result.error && !attempt ? (
          <p className="text-sm text-rejected">{result.error}</p>
        ) : (
          <PolicyVerdict
            verdict={rejected ? 'rejected' : 'allowed'}
            code={code}
            expected={result.expected}
            actual={result.evaluated ?? attempt?.code}
          >
            {txHash ? <ProofLink value={txHash} kind="near-tx" finalized={rejected} /> : null}
          </PolicyVerdict>
        )}
      </CardContent>
    </Card>
  );
}
