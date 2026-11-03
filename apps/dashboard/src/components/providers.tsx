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

  return (
    <SignReviewProvider>
      <LazyPrivy>{children}</LazyPrivy>
    </SignReviewProvider>
  );
}

function LazyPrivy({ children }: { children: ReactNode }) {
  const [Tree, setTree] = useState<ComponentType<{ children: ReactNode }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void import('./privy-tree')
      .then((mod) => {
        if (!cancelled) {
          setTree(() => mod.PrivyTree);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const inner = Tree ? (
    <Tree>{children}</Tree>
  ) : (
    <OwnerSessionProvider session={pendingSession}>{children}</OwnerSessionProvider>
  );

  return (
    <>
      {failed ? (
        <div
          role="alert"
          className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-foreground"
        >
          <button
            type="button"
            className="font-medium underline underline-offset-4"
            onClick={() => setAttempt((current) => current + 1)}
          >
            Sign-in failed to load, retry
          </button>
        </div>
      ) : null}
      {inner}
    </>
  );
}
