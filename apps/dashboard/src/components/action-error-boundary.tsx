'use client';

import { Component, type ErrorInfo, type ReactNode, type RefObject } from 'react';
import { nearExplorerTxUrl, publicConfig } from '@/lib/config';
import { logUnexpectedError } from '@/lib/error-display';

/**
 * Catches a render failure in the sign dialog or vault view and keeps the rest of the console
 * mounted. The real error is logged; the owner still gets the transaction link.
 */
export class ActionErrorBoundary extends Component<
  {
    children: ReactNode;
    scope: string;
    txHash?: string | null;
    txHashRef?: RefObject<string | null>;
  },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logUnexpectedError(this.props.scope, error);
    if (info.componentStack) {
      console.error(this.props.scope, info.componentStack);
    }
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    const txHash = this.props.txHash ?? this.props.txHashRef?.current ?? null;
    const href = txHash ? nearExplorerTxUrl(publicConfig.nearNetwork, txHash) : null;
    return (
      <div
        role="alert"
        className="m-6 rounded-lg border border-rejected-fill/40 bg-rejected-fill/10 p-4 text-sm text-rejected"
      >
        <p className="font-medium">{this.state.error.message}</p>
        {txHash && href ? (
          <p className="mt-3">
            <a href={href} target="_blank" rel="noreferrer" className="font-mono underline">
              {txHash}
            </a>
          </p>
        ) : null}
        <button
          type="button"
          className="mt-3 underline"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
