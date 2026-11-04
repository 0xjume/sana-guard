/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultDetail } from '@/components/vault-detail';
import { TooltipProvider } from '@/components/ui/tooltip';
import { OwnerSessionProvider, type OwnerSession } from '@/hooks/use-owner-session';
import { serializeVaultSnapshot, type VaultSnapshot } from '@/lib/vault-snapshot';
import type { ReactNode } from 'react';

const OWNER = 'HYMWqD9RRhscKNg6AdfV1ZDaAWDN6JTYXE3VGLXkajG5';
const TX = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnb';

const gate = vi.hoisted(() => ({ fail: false }));

vi.mock('@/components/policy-editor', () => ({
  PolicyEditor: ({ onUpdated }: { onUpdated?: (txHash?: string) => void }) => {
    if (gate.fail) {
      throw new Error('vault refresh render failed');
    }
    return (
      <button
        type="button"
        onClick={() => {
          gate.fail = true;
          onUpdated?.(TX);
        }}
      >
        Simulate refresh
      </button>
    );
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function rpc(text: string): Response {
  return json({ result: { result: Array.from(Buffer.from(text)) } });
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

const session: OwnerSession = {
  privyEnabled: true,
  ready: true,
  authenticated: true,
  owner: OWNER,
  signer: null,
  login: () => undefined,
  logout: () => undefined,
};

describe('vault detail render failure after an owner action', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    gate.fail = false;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === 'string' ? init.body : '';
      if (url.includes('/api/activity')) return json({ items: [] });
      if (url.includes('/api/attack-lab')) return json({ enabled: false });
      if (body.includes('getBalance') || url.includes('solana')) {
        return json({ result: { value: 1_000_000_000 } });
      }
      if (body.includes('get_vault')) {
        return rpc(
          JSON.stringify({
            owner: OWNER,
            vault_address: '84ffiaa3Y9CLV3xa5dPPcp85inQDC4mJ2FF6JtVZwq4J',
            path: `vault/${OWNER}/0`,
            state: 'Active',
            agents: [],
            policy: {
              per_tx_limit: [['Sol', '30000000']],
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
          })
        );
      }
      if (body.includes('get_recipients') || body.includes('get_spend_24h')) return rpc('[]');
      throw new Error(`unmocked fetch ${url} ${body.slice(0, 160)}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('shows an inline error with the tx link instead of replacing the console', async () => {
    render(
      <TooltipProvider delayDuration={200}>
        <p>owner console</p>
        <OwnerSessionProvider session={session}>
          <VaultDetail vaultId={1} initialSnapshot={serializeVaultSnapshot(snapshot())} />
        </OwnerSessionProvider>
      </TooltipProvider>
    );

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Simulate refresh' }));
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('vault refresh render failed');
    const link = alert.querySelector('a');
    expect(link?.textContent).toBe(TX);
    expect(link?.getAttribute('href')).toContain(`/txns/${TX}`);
    expect(screen.getByText('owner console')).toBeTruthy();
    expect(screen.queryByText('Sana Guard could not load')).toBeNull();
    expect(
      vi
        .mocked(console.error)
        .mock.calls.some((call) => call[0] === 'vault-detail' && call[1] instanceof Error)
    ).toBe(true);
  });
});
