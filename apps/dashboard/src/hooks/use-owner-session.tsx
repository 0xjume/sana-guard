'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Ed25519Signer } from '@sana-guard/sdk';

export interface OwnerSession {
  privyEnabled: boolean;
  ready: boolean;
  authenticated: boolean;
  owner: string | null;
  signer: Ed25519Signer | null;
  login: () => void;
  logout: () => void;
}

export const stubSession: OwnerSession = {
  privyEnabled: false,
  ready: true,
  authenticated: false,
  owner: null,
  signer: null,
  login: () => undefined,
  logout: () => undefined,
};

export const pendingSession: OwnerSession = {
  ...stubSession,
  privyEnabled: true,
  ready: false,
};

const OwnerSessionContext = createContext<OwnerSession>(stubSession);

export function OwnerSessionProvider({
  children,
  session = stubSession,
}: {
  children: ReactNode;
  session?: OwnerSession;
}) {
  return <OwnerSessionContext.Provider value={session}>{children}</OwnerSessionContext.Provider>;
}

export function useOwnerSession(): OwnerSession {
  return useContext(OwnerSessionContext);
}
