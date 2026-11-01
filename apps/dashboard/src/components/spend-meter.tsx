import { cn } from '@/lib/utils';

function meterTone(percent: number): string {
  if (percent >= 100) {
    return 'bg-rejected-fill';
  }
  if (percent >= 80) {
    return 'bg-warning';
  }
  return 'bg-primary';
}

function MeterRow({
  label,
  used,
  cap,
}: {
  label: string;
  used: string | null;
  cap: string | null;
}) {
  const usedNum = used === null ? 0 : Number(used);
  const capNum = cap === null ? 0 : Number(cap);
  const percent =
    cap === null || capNum <= 0 || Number.isNaN(usedNum) || Number.isNaN(capNum)
      ? 0
      : Math.min(100, Math.round((usedNum / capNum) * 1000) / 10);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="font-mono text-xs text-foreground">
          {used ?? '—'} / {cap ?? '—'} SOL
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label}
        className="h-2 overflow-hidden rounded-pill bg-secondary"
      >
        <div
          className={cn('h-full rounded-pill motion-safe:transition-all', meterTone(percent))}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function CapLabel({ label, cap }: { label: string; cap: string | null }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="font-mono text-sm text-foreground">{cap ?? '—'} SOL</p>
    </div>
  );
}

export function SpendMeter({
  perTxUsed,
  perTxCap,
  dailyUsed,
  dailyCap,
}: {
  perTxUsed?: string | null;
  perTxCap: string | null;
  dailyUsed: string | null;
  dailyCap: string | null;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {perTxUsed == null ? (
        <CapLabel label="Per-tx cap" cap={perTxCap} />
      ) : (
        <MeterRow label="Per-tx cap" used={perTxUsed} cap={perTxCap} />
      )}
      <MeterRow label="Rolling 24h cap" used={dailyUsed} cap={dailyCap} />
    </div>
  );
}
