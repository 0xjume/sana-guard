'use client';

import { Buffer } from 'buffer';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { OwnerSessionProvider } from '@/hooks/use-owner-session';
import { publicConfig } from '@/lib/config';

if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

export function Providers({ children }: { children: React.ReactNode }) {
  if (!publicConfig.privyAppId) {
    return <OwnerSessionProvider>{children}</OwnerSessionProvider>;
  }

  return (
    <PrivyProvider
      appId={publicConfig.privyAppId}
      clientId={publicConfig.privyClientId ?? undefined}
      config={{
        loginMethods: ['email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#d4a017',
          logo: undefined,
          walletChainType: 'solana-only',
        },
        embeddedWallets: {
          solana: {
            createOnLogin: 'users-without-wallets',
          },
        },
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors(),
          },
        },
      }}
    >
      <OwnerSessionProvider>{children}</OwnerSessionProvider>
    </PrivyProvider>
  );
}
