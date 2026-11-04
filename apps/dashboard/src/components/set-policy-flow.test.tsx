/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ed25519Signer } from '@sana-guard/sdk';
import { VaultDetail } from '@/components/vault-detail';
import { SignReviewProvider, useSignReview } from '@/components/sign-review';
import { TooltipProvider } from '@/components/ui/tooltip';
import { OwnerSessionProvider, type OwnerSession } from '@/hooks/use-owner-session';
import { serializeVaultSnapshot, type VaultSnapshot } from '@/lib/vault-snapshot';
import { useMemo, type ReactNode } from 'react';

const OWNER = 'HYMWqD9RRhscKNg6AdfV1ZDaAWDN6JTYXE3VGLXkajG5';
const TX = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnb';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function rpc(text: string): Response {
  return json({ result: { result: Array.from(Buffer.from(text)) } });
}

function vaultJson(perTx: string): string {
  return JSON.stringify({
    owner: OWNER,
    vault_address: '84ffiaa3Y9CLV3xa5dPPcp85inQDC4mJ2FF6JtVZwq4J',
    path: `vault/${OWNER}/0`,
    state: 'Active',
    agents: [],
    policy: {
      per_tx_limit: [['Sol', perTx]],
      daily_cap: [['Sol', '100000000']],
      programs: ['11111111111111111111111111111111'],
      max_priority_fee_lamports: '1',
      max_total_priority_fee_lamports: '1000000',
      max_memo_len: 64,
      expires_at_ns: '1800000000000000000',
      loosen_delay_ns: '3600000000000',
    },
    pending_loosen: null,
    paused: false,
  });
}

function snapshot(): VaultSnapshot {
  return {
    vaultId: 1,
    status: 'ok',
    vault: {
      owner: OWNER,
      vaultAddress: '84ffiaa3Y9CLV3xa5dPPcp85inQDC4mJ2FF6JtVZwq4J',
      path: `vault/${OWNER}/0`,
      agents: [],
      policy: {
        perTxLimit: [{ mint: { type: 'sol' }, amount: 40_000_000n }],
        dailyCap: [{ mint: { type: 'sol' }, amount: 100_000_000n }],
        programs: ['11111111111111111111111111111111'],
        maxPriorityFeeLamports: 1n,
        maxTotalPriorityFeeLamports: 1_000_000n,
        maxMemoLen: 64,
        expiresAtNs: 1_800_000_000_000_000_000n,
        loosenDelayNs: 3_600_000_000_000n,
      },
      paused: false,
      state: 'Active',
    },
    recipients: [],
    spend: [],
    balance: 1_000_000_000n,
  };
}

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function SessionHarness({ children }: { children: ReactNode }) {
  const review = useSignReview();
  const signer = useMemo<Ed25519Signer>(
    () => ({
      publicKey: new Uint8Array(32),
      sign: async (message) => {
        const text = new TextDecoder().decode(message);
        if (!(await review(text))) {
          throw new Error('Signing cancelled');
        }
        return new Uint8Array(64);
      },
    }),
    [review]
  );
  const session = useMemo<OwnerSession>(
    () => ({
      privyEnabled: true,
      ready: true,
      authenticated: true,
      owner: OWNER,
      signer,
      login: () => undefined,
      logout: () => undefined,
    }),
    [signer]
  );
  return <OwnerSessionProvider session={session}>{children}</OwnerSessionProvider>;
}

describe('SetPolicy success path', () => {
  let releaseSubmit: (response: Response) => void;
  let vaultReads = 0;
  let txPolls = 0;
  let submitted = false;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vaultReads = 0;
    txPolls = 0;
    submitted = false;
    releaseSubmit = () => {
      throw new Error('submit was not armed');
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    if (!('ResizeObserver' in globalThis)) {
      class ResizeObserverStub {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
      globalThis.ResizeObserver = ResizeObserverStub;
    }
    HTMLElement.prototype.scrollIntoView = () => undefined;
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === 'string' ? init.body : '';
      if (url.includes('/api/owner-action')) {
        submitted = true;
        return new Promise<Response>((resolve) => {
          releaseSubmit = resolve;
        });
      }
      if (url.includes('/api/owner-tx')) {
        txPolls += 1;
        if (txPolls === 1) {
          return json({ success: true, pending: true, txHash: TX });
        }
        return json({ success: true, pending: false, txHash: TX });
      }
      if (url.includes('/api/activity')) {
        return json({ items: [] });
      }
      if (url.includes('/api/attack-lab')) {
        return json({ enabled: false });
      }
      if (body.includes('getBalance') || url.includes('solana')) {
        return json({ result: { value: 1_000_000_000 } });
      }
      if (body.includes('owner_nonce')) {
        return rpc('110');
      }
      if (body.includes('get_vault')) {
        vaultReads += 1;
        return rpc(vaultJson(submitted ? '30000000' : '40000000'));
      }
      if (body.includes('get_recipients') || body.includes('get_spend_24h')) {
        return rpc('[]');
      }
      if (body.includes('"version"') || body.includes('method_name":"version"')) {
        return rpc(JSON.stringify({ version: '0.1.0', git_sha: 'abc' }));
      }
      throw new Error(`unmocked fetch ${url} ${body.slice(0, 180)}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  async function settle(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it('shows submitting, then confirming with the tx link, then reloads the vault', async () => {
    render(
      <SignReviewProvider>
        <SessionHarness>
          {/* Production puts TooltipProvider in AppShell, under SignReviewProvider.
              The review dialog is a sibling of that shell, so it is outside the provider. */}
          <TooltipProvider delayDuration={200}>
            <VaultDetail vaultId={1} initialSnapshot={serializeVaultSnapshot(snapshot())} />
          </TooltipProvider>
        </SessionHarness>
      </SignReviewProvider>
    );

    await settle();
    expect(vaultReads).toBeGreaterThan(0);
    const readsAfterMount = vaultReads;

    fireEvent.change(screen.getByLabelText('Per-tx SOL'), { target: { value: '0.03' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign SetPolicy' }));
    });
    await settle();

    const sign = screen.getByRole('button', { name: 'Sign with wallet' });
    await act(async () => {
      fireEvent.click(sign);
    });
    expect(screen.getAllByText('Submitting…').length).toBeGreaterThan(0);
    expect(screen.queryByText('Confirming on NEAR…')).toBeNull();

    await act(async () => {
      releaseSubmit(json({ success: true, pending: true, txHash: TX }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getAllByText('Confirming on NEAR…').length).toBeGreaterThan(0);
    const proof = document.querySelector(`a[href*="${TX}"]`);
    expect(proof).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(screen.getByText('Policy submitted.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign with wallet' })).toBeNull();
    expect(vaultReads).toBe(readsAfterMount + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(vaultReads).toBe(readsAfterMount + 2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(vaultReads).toBe(readsAfterMount + 3);
    expect(screen.getAllByText('0.03 SOL').length).toBeGreaterThan(0);
  });
});
