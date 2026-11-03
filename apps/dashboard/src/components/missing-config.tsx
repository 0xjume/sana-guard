import { ChevronDown, CircleAlert } from 'lucide-react';
import { publicConfig } from '@/lib/config';

export function MissingConfig() {
  return (
    <details className="group rounded-lg border border-warning/40 bg-warning/[0.06] shadow-e0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <CircleAlert aria-hidden className="size-5 shrink-0 text-warning" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            Sign-in is not configured
          </span>
          <span className="block text-xs text-muted-foreground">
            <code>NEXT_PUBLIC_PRIVY_APP_ID</code> is not set. Read-only NEAR views still work.
          </span>
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">Setup steps</span>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-warning/20 px-5 pb-5 pt-4">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
          <li>
            Create a Privy app, enable Solana embedded wallets, and add this origin to allowed
            domains.
          </li>
          <li>
            Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> (and optionally{' '}
            <code>NEXT_PUBLIC_PRIVY_CLIENT_ID</code>) in Vercel / <code>.env.local</code>.
          </li>
          <li>
            Set server-only <code>INVITE_TOKEN</code> if the relay still gates CreateVault /
            AddAgent. The browser never receives that token; <code>POST /api/owner-action</code>{' '}
            attaches it after Privy auth. Leave <code>OWNER_ALLOWLIST</code> unset for open sign-up
            (one vault per owner).
          </li>
        </ol>
        <dl className="mt-5 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Guard</dt>
            <dd className="font-mono">{publicConfig.guardContract}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">NEAR</dt>
            <dd className="font-mono">{publicConfig.nearNetwork}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Relay</dt>
            <dd className="break-all font-mono">{publicConfig.relayUrl}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Solana RPC</dt>
            <dd className="break-all font-mono">{publicConfig.solanaRpcUrl}</dd>
          </div>
        </dl>
      </div>
    </details>
  );
}
