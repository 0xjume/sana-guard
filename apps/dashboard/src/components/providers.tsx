'use client';

import { Buffer } from 'buffer';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { OwnerSessionProvider, pendingSession } from '@/hooks/use-owner-session';
import { SignReviewProvider } from '@/components/sign-review';
import { publicConfig } from '@/lib/config';

if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

export function Providers({ children }: { children: ReactNode }) {
  if (!publicConfig.privyAppId) {
    return (
      <SignReviewProvider>
        <OwnerSessionProvider>{children}</OwnerSessionProvider>
      </SignReviewProvider>
    );
  }

  return <LazyPrivy>{children}</LazyPrivy>;
}

function LazyPrivy({ children }: { children: ReactNode }) {
  const [Tree, setTree] = useState<ComponentType<{ children: ReactNode }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('./privy-tree').then((mod) => {
      if (!cancelled) {
        setTree(() => mod.PrivyTree);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Tree) {
    return (
      <SignReviewProvider>
        <OwnerSessionProvider session={pendingSession}>{children}</OwnerSessionProvider>
      </SignReviewProvider>
    );
  }

  return <Tree>{children}</Tree>;
}
