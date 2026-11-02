'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ChevronDown, ShieldAlert } from 'lucide-react';
import { describeAdminMessage, type AdminMessageReview } from '@/lib/admin-message';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Resolves true when the owner approves signing `message`, false when they cancel. */
export type ReviewAdminMessage = (message: string) => Promise<boolean>;

const SignReviewContext = createContext<ReviewAdminMessage>(async () => false);

export function useSignReview(): ReviewAdminMessage {
  return useContext(SignReviewContext);
}

interface Pending {
  message: string;
  review: AdminMessageReview | null;
  error: string | null;
}

function ReviewBody({ pending }: { pending: Pending }) {
  const { review, error, message } = pending;
  return (
    <div className="space-y-4">
      {review ? (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md border border-border bg-background/40 p-4 text-sm">
            <dt className="text-muted-foreground">Vault</dt>
            <dd className="font-mono">{review.vault}</dd>
            {review.rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="break-all font-mono">{row.value}</dd>
              </div>
            ))}
          </dl>
          {review.warnings.map((warning) => (
            <p
              key={warning}
              className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning"
            >
              <ShieldAlert aria-hidden className="size-4 shrink-0" />
              {warning}
            </p>
          ))}
          <p className="text-xs text-muted-foreground">
            {review.network} · {review.contract} · nonce {review.nonce} · valid until{' '}
            {review.expires}
          </p>
        </>
      ) : (
        <p className="rounded-md border border-rejected-fill/40 bg-rejected-fill/10 p-3 text-sm text-rejected">
          This message could not be decoded ({error}). Only sign it if you trust the raw text below.
        </p>
      )}
      <details className="group rounded-md border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
          Exact message to be signed
          <ChevronDown
            aria-hidden
            className="size-4 motion-safe:transition-transform group-open:rotate-180"
          />
        </summary>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all border-t border-border p-3 font-mono text-[11px] leading-5">
          {message}
        </pre>
      </details>
    </div>
  );
}

/**
 * Hosts the "review before signing" dialog. The owner signer awaits `review(message)` before it
 * asks the wallet for a signature, so every owner action goes through this screen.
 */
export function SignReviewProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const resolver = useRef<((approved: boolean) => void) | null>(null);

  const settle = useCallback((approved: boolean) => {
    resolver.current?.(approved);
    resolver.current = null;
    setPending(null);
  }, []);

  const review = useCallback<ReviewAdminMessage>((message) => {
    // A newer request replaces an unanswered one; the older caller sees a cancel.
    resolver.current?.(false);
    let decoded: AdminMessageReview | null = null;
    let error: string | null = null;
    try {
      decoded = describeAdminMessage(message);
    } catch (err) {
      error = err instanceof Error ? err.message : 'unknown format';
    }
    setPending({ message, review: decoded, error });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  return (
    <SignReviewContext.Provider value={review}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => (open ? undefined : settle(false))}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <p className="kicker">Review before signing</p>
            <DialogTitle>{pending?.review?.title ?? 'Owner action'}</DialogTitle>
            <DialogDescription>
              Your wallet will sign exactly the message below. The guard contract verifies the
              signature and applies it on-chain.
            </DialogDescription>
          </DialogHeader>
          {pending ? <ReviewBody pending={pending} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => settle(true)}>
              Sign with wallet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SignReviewContext.Provider>
  );
}
