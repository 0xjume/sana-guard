import { ShieldX } from 'lucide-react';
import { ATTACK_LABELS, type AttackKind } from '@/lib/attack-lab';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PolicyVerdict } from '@/components/policy-verdict';

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
    };
  }>;
}

function isAttackKind(value: string | undefined): value is AttackKind {
  return Boolean(value && value in ATTACK_LABELS);
}

export type AttackOutcomeKind = 'rejected' | 'bypassed' | 'unexpected' | 'failed';

export const NO_SIGNATURE_NOTE = 'No signature was produced.';

export function isOnChainRejection(result: AttackLabResult): boolean {
  const attempt = result.attempts?.[0]?.result;
  return Boolean(attempt && !attempt.unexpected && attempt.code === result.expected);
}

export function classifyAttackOutcome(result: AttackLabResult): AttackOutcomeKind | null {
  const attempt = result.attempts?.[0]?.result;
  if (!attempt) {
    return result.error ? 'failed' : null;
  }
  if (isOnChainRejection(result)) {
    return 'rejected';
  }
  if (attempt.unexpected) {
    return 'bypassed';
  }
  if (!attempt.code) {
    return 'failed';
  }
  return 'unexpected';
}

export function attackOutcomeHeading(outcome: AttackOutcomeKind): string {
  if (outcome === 'rejected') {
    return 'Blocked by guard';
  }
  if (outcome === 'bypassed') {
    return 'ALLOWED — guard bypassed';
  }
  if (outcome === 'failed') {
    return 'Request failed';
  }
  return 'Unexpected outcome';
}

export function unexpectedOutcomeDetail(result: AttackLabResult): string | undefined {
  const attempt = result.attempts?.[0]?.result;
  return attempt?.code ?? attempt?.message;
}

function UnexpectedOutcomeCard({
  heading,
  detail,
  kicker = 'On-chain result',
}: {
  heading: string;
  detail?: string;
  kicker?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-warning/40 bg-warning/10 p-5"
    >
      <p className="sr-only">
        {heading}
        {detail ? ` ${detail}` : ''}
      </p>
      <p className="kicker">{kicker}</p>
      <p className="mt-1 font-heading text-2xl font-semibold tracking-tight text-warning">
        {heading}
      </p>
      {detail ? <p className="mt-2 font-mono text-sm text-foreground">{detail}</p> : null}
    </div>
  );
}

function FailedRequestCard({ detail }: { detail?: string }) {
  return (
    <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-5">
      <p className="sr-only">Request failed{detail ? ` ${detail}` : ''}</p>
      <p className="kicker">Transport</p>
      <p className="mt-1 font-heading text-2xl font-semibold tracking-tight text-warning">
        Request failed
      </p>
      {detail ? <p className="mt-2 text-sm text-foreground">{detail}</p> : null}
      <p className="mt-2 text-sm text-muted-foreground">
        This is a network or server error, not a policy block. The guard did not evaluate a
        signature request.
      </p>
    </div>
  );
}

export function AttackAttemptCard({ result }: { result: AttackLabResult }) {
  const kindLabel = isAttackKind(result.kind) ? ATTACK_LABELS[result.kind] : result.kind;
  const attempt = result.attempts?.[0]?.result;
  const ran = Boolean(attempt);
  const outcome = classifyAttackOutcome(result);

  return (
    <Card className="border-rejected-fill/30">
      <CardHeader className="gap-3">
        <p className="kicker">Attack attempt</p>
        <div className="flex flex-wrap items-center gap-2">
          <ShieldX className="h-5 w-5 text-rejected" aria-hidden />
          <CardTitle as="h3" className="text-lg">
            {kindLabel ?? 'Policy probe'}
          </CardTitle>
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
              {!ran
                ? 'Not run'
                : (attempt?.unexpected ?? attempt?.message ?? result.error ?? 'Rejected on-chain')}
            </p>
          </li>
        </ol>
        {result.error && outcome === 'failed' && !ran ? null : result.error && !ran ? (
          <p className="text-sm text-rejected">{result.error}</p>
        ) : null}
        {outcome === 'failed' ? (
          <FailedRequestCard detail={result.error ?? unexpectedOutcomeDetail(result)} />
        ) : !ran || !outcome ? (
          <p className="text-sm text-muted-foreground">On-chain attempt not run.</p>
        ) : outcome === 'rejected' ? (
          <PolicyVerdict
            verdict="rejected"
            heading={attackOutcomeHeading(outcome)}
            code={attempt?.code}
            expected={result.expected}
            actual={attempt?.code}
          >
            <p className="text-sm text-muted-foreground">{NO_SIGNATURE_NOTE}</p>
          </PolicyVerdict>
        ) : outcome === 'bypassed' ? (
          <PolicyVerdict
            verdict="allowed"
            heading={attackOutcomeHeading(outcome)}
            code={attempt?.code}
            expected={result.expected}
            actual={attempt?.unexpected ?? attempt?.code}
          />
        ) : (
          <UnexpectedOutcomeCard
            heading={attackOutcomeHeading('unexpected')}
            detail={unexpectedOutcomeDetail(result)}
          />
        )}
      </CardContent>
    </Card>
  );
}
