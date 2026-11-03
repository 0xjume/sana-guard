import { cn } from '@/lib/utils';

export function NetworkPill({ network }: { network: string }) {
  const testnet = network.toLowerCase() === 'testnet';
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-border bg-secondary/80 px-2 py-1 text-xs font-medium text-foreground sm:gap-2 sm:px-3">
      <span
        className={cn('h-2 w-2 rounded-full', testnet ? 'bg-primary' : 'bg-rejected-fill')}
        aria-hidden
      />
      <span className="font-mono uppercase tracking-[0.12em]">{network}</span>
    </span>
  );
}
