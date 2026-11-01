import { cn } from '@/lib/utils';

export function SgMark({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      role="img"
      aria-label="Sana Guard"
    >
      <rect
        x="1"
        y="1"
        width="38"
        height="38"
        rx="11"
        fill="hsl(var(--background))"
        stroke="hsl(var(--primary))"
        strokeWidth="1.5"
      />
      <path
        d="M20 6.8 31 11v9.6c0 6.4-4.7 11.7-11 13.6C13.7 32.3 9 27 9 20.6V11L20 6.8z"
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="1.5"
      />
      <text
        x="20"
        y="23.5"
        textAnchor="middle"
        fill="hsl(var(--primary))"
        fontFamily="var(--font-mono), ui-monospace, SFMono-Regular, monospace"
        fontSize="12"
        fontWeight="700"
        letterSpacing="0.5"
      >
        SG
      </text>
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <SgMark />
      <span className="flex flex-col">
        <span className="font-heading text-base font-semibold tracking-tight text-foreground">
          Sana Guard
        </span>
        {compact ? null : <span className="text-xs text-muted-foreground">Owner console</span>}
      </span>
    </span>
  );
}
