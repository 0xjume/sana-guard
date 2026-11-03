'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { addressExplorerUrl, publicConfig, type AddressChain } from '@/lib/config';
import { shortenAddress } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function AddressChip({
  value,
  chain,
  label,
  display = 'truncate',
  compact = false,
  className,
}: {
  value: string;
  chain: AddressChain;
  label?: string;
  display?: 'truncate' | 'full';
  compact?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const href = addressExplorerUrl({
    chain,
    value,
    nearNetwork: publicConfig.nearNetwork,
    solanaRpcUrl: publicConfig.solanaRpcUrl,
  });
  const chainLabel = chain === 'near' ? 'NEAR account' : 'Solana address';
  const shown =
    display === 'full' ? value : shortenAddress(value, compact ? 4 : 6, compact ? 4 : 6);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copied to clipboard');
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-pill border border-border bg-secondary/70 px-2 py-1 text-foreground',
        display === 'full' && 'w-full rounded-md px-3 py-2',
        compact && 'px-1.5 py-0.5',
        className
      )}
    >
      {label ? (
        <span className={cn('kicker px-1', compact && 'hidden sm:inline')}>{label}</span>
      ) : null}
      <span
        className={cn(
          'min-w-0 font-mono text-xs',
          display === 'full' ? 'flex-1 break-all leading-5' : 'truncate'
        )}
        title={value}
      >
        {shown}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative h-7 w-7 shrink-0 after:absolute after:-inset-2 after:content-['']"
            onClick={() => void copy()}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="sr-only">Copy {chainLabel}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy full address</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "relative h-7 w-7 shrink-0 after:absolute after:-inset-2 after:content-['']",
              compact && 'max-sm:hidden'
            )}
            asChild
          >
            <a href={href} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="sr-only">Open {chainLabel} in explorer</span>
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open explorer</TooltipContent>
      </Tooltip>
    </span>
  );
}
