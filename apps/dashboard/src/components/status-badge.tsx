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
}: {
  tone: 'ok' | 'warn' | 'danger' | 'muted';
  children: ReactNode;
}) {
  return <Badge variant={TONE_VARIANT[tone]}>{children}</Badge>;
}
