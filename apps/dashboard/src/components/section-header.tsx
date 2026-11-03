import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Card header used across the console: icon tile, kicker, title, optional description and a
 * right-aligned action slot.
 */
export function SectionHeader({
  icon: Icon,
  kicker,
  title,
  description,
  action,
  tone = 'default',
  className,
}: {
  icon?: LucideIcon;
  kicker?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'danger' | 'warn';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4 p-6 sm:flex-row sm:items-start', className)}>
      <div className="flex min-w-0 flex-1 gap-4">
        {Icon ? (
          <span
            aria-hidden
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-md border',
              tone === 'danger'
                ? 'border-rejected-fill/30 bg-rejected-fill/10 text-rejected'
                : tone === 'warn'
                  ? 'border-warning/30 bg-warning/10 text-warning'
                  : 'border-primary/25 bg-primary/10 text-primary'
            )}
          >
            <Icon className="size-5" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {kicker ? <p className="kicker">{kicker}</p> : null}
          <h2 className="mt-1 font-heading text-xl font-semibold tracking-tight">{title}</h2>
          {description ? (
            <div className="mt-2 text-sm leading-6 text-muted-foreground">{description}</div>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
