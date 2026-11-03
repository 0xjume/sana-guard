import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function StatTile({
  icon: Icon,
  label,
  value,
  unit,
  hint,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative min-w-0 overflow-hidden rounded-lg border border-border bg-card/80 p-4 shadow-e0 sm:p-5',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon aria-hidden className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-3 flex min-w-0 items-baseline gap-1.5 font-mono text-lg font-medium tracking-tight sm:text-2xl">
        <span className="truncate">{value}</span>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

/** Thin usage bar (green → amber at 80% → red at 100%), matching SpendMeter tones. */
export function UsageBar({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const tone = clamped >= 100 ? 'bg-rejected-fill' : clamped >= 80 ? 'bg-warning' : 'bg-primary';
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className="h-1.5 overflow-hidden rounded-pill bg-secondary"
    >
      <div
        className={cn('h-full rounded-pill motion-safe:transition-all', tone)}
        style={{ width: clamped === 0 ? '0%' : `max(2px, ${clamped}%)` }}
      />
    </div>
  );
}
