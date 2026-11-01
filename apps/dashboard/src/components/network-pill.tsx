import { cn } from '@/lib/utils';

export function NetworkPill({ network }: { network: string }) {
  const testnet = network.toLowerCase() === 'testnet';
  return (
    <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-secondary/80 px-3 py-1 text-xs font-medium text-foreground">
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          testnet ? 'bg-primary motion-safe:animate-pulse' : 'bg-rejected-fill'
        )}
        aria-hidden
      />
      <span className="font-mono uppercase tracking-[0.12em]">{network}</span>
    </span>
  );
}
