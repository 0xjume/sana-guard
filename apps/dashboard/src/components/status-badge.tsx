import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

const TONE_VARIANT = {
  ok: 'default',
  warn: 'warning',
  danger: 'destructive',
  muted: 'muted',
} as const;

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'muted';
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge variant={TONE_VARIANT[tone]} className={className}>
      {children}
    </Badge>
  );
}
