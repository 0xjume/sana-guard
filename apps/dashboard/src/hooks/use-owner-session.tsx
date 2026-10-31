'use client';

import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSignMessage, useWallets } from '@privy-io/react-auth/solana';
import bs58 from 'bs58';
import type { Ed25519Signer } from '@sana-guard/sdk';
import { publicConfig } from '@/lib/config';
import { registerPrivyAccessTokenGetter } from '@/lib/privy-browser-token';

export interface OwnerSession {
  privyEnabled: boolean;
  ready: boolean;
  authenticated: boolean;
  owner: string | null;
  signer: Ed25519Signer | null;
  login: () => void;
  logout: () => void;
}

const stub: OwnerSession = {
  privyEnabled: false,
  ready: true,
  authenticated: false,
  owner: null,
  signer: null,
  login: () => undefined,
  logout: () => undefined,
};

const OwnerSessionContext = createContext<OwnerSession>(stub);

function asSignature(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value && typeof value === 'object' && 'signature' in value) {
    const signature = (value as { signature: unknown }).signature;
    if (signature instanceof Uint8Array) {
      return signature;
    }
    if (typeof signature === 'string') {
      return bs58.decode(signature);
    }
    if (Array.isArray(signature)) {
      return Uint8Array.from(signature);
    }
  }
  if (typeof value === 'string') {
    return bs58.decode(value);
  }
  throw new Error('Privy did not return a 64-byte Solana signature');
}

function LiveOwnerSessionProvider({ children }: { children: React.ReactNode }) {
  const privy = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signMessage } = useSignMessage();

  const wallet = wallets[0];
  const owner = wallet?.address ?? null;

  const signer: Ed25519Signer | null = useMemo(() => {
    if (!owner || !wallet) {
      return null;
    }
    return {
      publicKey: bs58.decode(owner),
      sign: async (message: Uint8Array) => {
        const signed = await signMessage({
          message,
          wallet,
          options: { uiOptions: { title: 'Sana Guard owner action' } },
        });
        const signature = asSignature(signed);
        if (signature.length !== 64) {
          throw new Error(`Expected 64-byte signature, got ${signature.length}`);
        }
        return signature;
      },
    };
  }, [owner, signMessage, wallet]);

  useEffect(() => {
    registerPrivyAccessTokenGetter(() => privy.getAccessToken());
    return () => registerPrivyAccessTokenGetter(null);
  }, [privy]);

  const login = useCallback(() => {
    void privy.login();
  }, [privy]);

  const logout = useCallback(() => {
    void privy.logout();
  }, [privy]);

  const value = useMemo<OwnerSession>(
    () => ({
      privyEnabled: true,
      ready: privy.ready && walletsReady,
      authenticated: privy.authenticated,
      owner,
      signer,
      login,
      logout,
    }),
    [login, logout, owner, privy.authenticated, privy.ready, signer, walletsReady]
  );

  return <OwnerSessionContext.Provider value={value}>{children}</OwnerSessionContext.Provider>;
}

export function OwnerSessionProvider({ children }: { children: React.ReactNode }) {
  if (!publicConfig.privyAppId) {
    return <OwnerSessionContext.Provider value={stub}>{children}</OwnerSessionContext.Provider>;
  }
  return <LiveOwnerSessionProvider>{children}</LiveOwnerSessionProvider>;
}

export function useOwnerSession(): OwnerSession {
  return useContext(OwnerSessionContext);
}
