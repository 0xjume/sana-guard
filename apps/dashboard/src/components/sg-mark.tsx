import { cn } from '@/lib/utils';

/** Traced from the owner S mark. Coordinates are in a 40×40 viewBox. */
const S_MARK_PATH =
  'M17.125 9.708C15.104 10.25 13.646 11.292 12.854 12.792L12.396 13.646V17.188L12.854 18.042C13.708 19.625 14.896 20.396 18.479 21.583C21.25 22.5 22.042 22.979 22.438 23.896L22.729 24.625L22.354 25.375L21.979 26.146L21.146 26.417C20.667 26.583 20 26.625 19.604 26.562C18.75 26.396 17.5 25.229 17.5 24.604V24.167H12.292V24.833C12.312 25.792 13 27.25 13.917 28.188C15.479 29.812 17.708 30.521 20.854 30.375L22.812 30.292L23.958 29.771C26.292 28.688 27.521 27 27.667 24.688C27.875 21.396 26.458 19.854 21.625 18.167C18.292 16.979 17.5 16.396 17.5 15.042C17.5 14.562 17.667 14.208 18.042 13.854L18.604 13.333H19.521C20.896 13.333 22.063 14.125 22.083 15.042V15.417H27.5V15.146C27.5 15 27.354 14.375 27.167 13.771C26.771 12.437 25.521 11 24.167 10.312C22.292 9.375 19.312 9.104 17.125 9.708Z';

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
      <title>Sana Guard</title>
      <rect width="40" height="40" rx="7.2" fill="#50d75e" />
      <path d={S_MARK_PATH} fill="#090f0a" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 sm:gap-3">
      <SgMark size={32} className="sm:hidden" />
      <SgMark className="hidden sm:block" />
      <span className={compact ? 'hidden flex-col sm:flex' : 'flex flex-col'}>
        <span className="font-heading text-base font-semibold tracking-tight text-foreground">
          Sana Guard
        </span>
        {compact ? null : <span className="text-xs text-muted-foreground">Owner console</span>}
      </span>
    </span>
  );
}
