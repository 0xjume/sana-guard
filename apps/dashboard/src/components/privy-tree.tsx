'use client';

import { Buffer } from 'buffer';
import type { ReactNode } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { LiveOwnerSessionProvider } from '@/hooks/live-owner-session';
import { SignReviewProvider } from '@/components/sign-review';
import { publicConfig } from '@/lib/config';

if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

export function PrivyTree({ children }: { children: ReactNode }) {
  if (!publicConfig.privyAppId) {
    return children;
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
        <LiveOwnerSessionProvider>{children}</LiveOwnerSessionProvider>
      </SignReviewProvider>
    </PrivyProvider>
  );
}
