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
      <rect width="40" height="40" rx="12" fill="#121614" stroke="#15c15d" strokeWidth="1.5" />
      <path
        d="M20 7.2 30.5 11v9.4c0 6.2-4.6 11.3-10.5 13.2C13.9 31.7 9.5 26.6 9.5 20.4V11L20 7.2z"
        fill="none"
        stroke="#15c15d"
        strokeWidth="1.6"
      />
      <path
        d="M14.4 17.1c0-2.1 1.7-3.4 4.2-3.4 2.1 0 3.8 1 3.8 2.8 0 1.3-.9 2.1-2.5 2.7l-1.5.5c-1 .3-1.4.7-1.4 1.3 0 .7.6 1.1 1.7 1.1 1.2 0 2-.5 2.4-1.4l1.7.6c-.6 1.7-2.2 2.7-4.1 2.7-2.5 0-4.1-1.3-4.1-3.3 0-1.5 1-2.5 2.8-3.1l1.6-.6c.9-.3 1.2-.6 1.2-1.1 0-.6-.5-1-1.5-1-1 0-1.8.5-2.1 1.3l-2.2-.6Zm11.2 7.6V14.2h2.1v10.5h-2.1z"
        fill="#15c15d"
      />
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
