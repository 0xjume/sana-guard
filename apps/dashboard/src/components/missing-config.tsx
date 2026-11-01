import { publicConfig } from '@/lib/config';

export function MissingConfig() {
  return (
    <section className="panel border-brass-500/40">
      <p className="kicker">Configuration</p>
      <h1 className="mt-2 text-2xl font-semibold text-parchment-100">Missing Privy app ID</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-parchment-400">
        This dashboard builds and renders without <code>NEXT_PUBLIC_PRIVY_APP_ID</code>, but owners
        cannot sign in until you create a Privy app with Solana embedded wallets and set that
        variable. Read-only NEAR views still work below.
      </p>
      <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-parchment-100">
        <li>
          Create a Privy app, enable Solana embedded wallets, and add this origin to allowed
          domains.
        </li>
        <li>
          Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> (and optionally{' '}
          <code>NEXT_PUBLIC_PRIVY_CLIENT_ID</code>) in Vercel / <code>.env.local</code>.
        </li>
        <li>
          Set server-only <code>INVITE_TOKEN</code> if the relay still gates CreateVault / AddAgent.
          The browser never receives that token; <code>POST /api/owner-action</code> attaches it.
        </li>
      </ol>
      <dl className="mt-6 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-parchment-400">Guard</dt>
          <dd className="font-mono">{publicConfig.guardContract}</dd>
        </div>
        <div>
          <dt className="text-parchment-400">NEAR</dt>
          <dd className="font-mono">{publicConfig.nearNetwork}</dd>
        </div>
        <div>
          <dt className="text-parchment-400">Relay</dt>
          <dd className="font-mono break-all">{publicConfig.relayUrl}</dd>
        </div>
        <div>
          <dt className="text-parchment-400">Solana RPC</dt>
          <dd className="font-mono break-all">{publicConfig.solanaRpcUrl}</dd>
        </div>
      </dl>
    </section>
  );
}
