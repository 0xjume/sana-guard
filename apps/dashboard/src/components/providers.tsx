'use client';

import { Buffer } from 'buffer';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { OwnerSessionProvider } from '@/hooks/use-owner-session';
import { SignReviewProvider } from '@/components/sign-review';
import { publicConfig } from '@/lib/config';

if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

export function Providers({ children }: { children: React.ReactNode }) {
  if (!publicConfig.privyAppId) {
    return (
      <SignReviewProvider>
        <OwnerSessionProvider>{children}</OwnerSessionProvider>
      </SignReviewProvider>
    );
  }

  return (
    <PrivyProvider
      appId={publicConfig.privyAppId}
      clientId={publicConfig.privyClientId ?? undefined}
      config={{
        loginMethods: ['email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#15c15d',
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
      <SignReviewProvider>
        <OwnerSessionProvider>{children}</OwnerSessionProvider>
      </SignReviewProvider>
    </PrivyProvider>
  );
}
