'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { nearExplorerTxUrl, publicConfig, solanaExplorerAddressUrl } from '@/lib/config';
import { shortenAddress } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function solanaExplorerTxUrl(rpcUrl: string, signature: string): string {
  const cluster = rpcUrl.includes('mainnet')
    ? 'mainnet-beta'
    : rpcUrl.includes('testnet')
      ? 'testnet'
      : 'devnet';
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export function ProofLink({
  value,
  kind,
  finalized = false,
  label,
}: {
  value: string;
  kind: 'near-tx' | 'solana-tx' | 'solana-address';
  finalized?: boolean;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const href =
    kind === 'near-tx'
      ? nearExplorerTxUrl(publicConfig.nearNetwork, value)
      : kind === 'solana-tx'
        ? solanaExplorerTxUrl(publicConfig.solanaRpcUrl, value)
        : solanaExplorerAddressUrl(publicConfig.solanaRpcUrl, value);
  const kindLabel =
    kind === 'near-tx' ? 'NEAR tx' : kind === 'solana-tx' ? 'Solana tx' : 'Solana address';

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
        'inline-flex max-w-full items-center gap-1 rounded-pill border bg-secondary/70 px-2 py-1',
        finalized ? 'border-primary/50 text-accent' : 'border-border text-foreground'
      )}
    >
      <span className="kicker px-1">{label ?? kindLabel}</span>
      <span className="font-mono text-xs">{shortenAddress(value, 6, 6)}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void copy()}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="sr-only">Copy {kindLabel}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy full hash</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
            <a href={href} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="sr-only">Open {kindLabel} in explorer</span>
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open explorer</TooltipContent>
      </Tooltip>
    </span>
  );
}
