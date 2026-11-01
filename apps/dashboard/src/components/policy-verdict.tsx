import type { ReactNode } from 'react';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { getErrorMessage } from '@sana-guard/sdk';
import { ruleNameFromCode } from '@/lib/error-display';
import { cn } from '@/lib/utils';

export function PolicyVerdict({
  verdict,
  code,
  ruleName,
  expected,
  actual,
  children,
}: {
  verdict: 'allowed' | 'rejected';
  code?: string;
  ruleName?: string;
  expected?: string;
  actual?: string;
  children?: ReactNode;
}) {
  const rejected = verdict === 'rejected';
  const resolvedRule = ruleName ?? (code ? ruleNameFromCode(code) : undefined);
  const description = code ? getErrorMessage(code) : undefined;
  const announcement = rejected
    ? `Rejected${code ? ` ${code}` : ''}${resolvedRule ? ` ${resolvedRule}` : ''}`
    : 'Allowed';

  return (
    <div
      role={rejected ? 'alert' : 'status'}
      aria-live="polite"
      className={cn(
        'rounded-lg border p-5',
        rejected ? 'border-rejected-fill/40 bg-rejected-fill/10' : 'border-primary/40 bg-primary/10'
      )}
    >
      <p className="sr-only">{announcement}</p>
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-md',
            rejected ? 'bg-rejected-fill/15 text-rejected' : 'bg-primary/15 text-accent'
          )}
        >
          {rejected ? <ShieldX className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="kicker">{rejected ? 'Policy check' : 'Policy check'}</p>
          <p
            className={cn(
              'mt-1 font-heading text-3xl font-semibold tracking-tight',
              rejected ? 'text-rejected' : 'text-accent'
            )}
          >
            {rejected ? 'REJECTED' : 'ALLOWED'}
          </p>
          {code ? (
            <p className="mt-2 font-mono text-sm text-foreground">
              {code}
              {resolvedRule ? (
                <span className="text-muted-foreground"> · {resolvedRule}</span>
              ) : null}
            </p>
          ) : null}
          {description && description !== `Unknown error: ${code}` ? (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
          {expected || actual ? (
            <dl className="mt-4 grid gap-2 rounded-md bg-background/50 p-3 font-mono text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Expected</dt>
                <dd className="mt-1 break-all text-foreground">{expected ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Actual</dt>
                <dd className="mt-1 break-all text-foreground">{actual ?? '—'}</dd>
              </div>
            </dl>
          ) : null}
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}
