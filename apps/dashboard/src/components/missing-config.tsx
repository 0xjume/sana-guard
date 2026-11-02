import { publicConfig } from '@/lib/config';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function MissingConfig() {
  return (
    <Card className="border-warning/40 shadow-e1">
      <CardHeader>
        <p className="kicker">Configuration</p>
        <CardTitle className="text-2xl">Missing Privy app ID</CardTitle>
        <CardDescription>
          This dashboard builds and renders without <code>NEXT_PUBLIC_PRIVY_APP_ID</code>, but
          owners cannot sign in until you create a Privy app with Solana embedded wallets and set
          that variable. Read-only NEAR views still work below.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
        <dl className="mt-6 grid gap-3 text-xs sm:grid-cols-2">
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
      </CardContent>
    </Card>
  );
}
