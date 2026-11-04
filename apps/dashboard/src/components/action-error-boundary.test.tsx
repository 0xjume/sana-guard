/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionErrorBoundary } from './action-error-boundary';

const TX = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnb';

function Exploding({ explode }: { explode: boolean }) {
  if (explode) {
    throw new Error('post-action refresh failed');
  }
  return <p>vault detail</p>;
}

function Harness({ txHash }: { txHash: string | null }) {
  const [explode, setExplode] = useState(true);
  return (
    <>
      <p>owner console</p>
      <button type="button" onClick={() => setExplode(false)}>
        Heal
      </button>
      <ActionErrorBoundary scope="vault-detail" txHash={txHash}>
        <Exploding explode={explode} />
      </ActionErrorBoundary>
    </>
  );
}

describe('ActionErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the error and tx link inline and leaves the rest of the console mounted', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Harness txHash={TX} />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('post-action refresh failed');
    const link = alert.querySelector('a');
    expect(link?.textContent).toBe(TX);
    expect(link?.getAttribute('href')).toContain(`/txns/${TX}`);
    expect(screen.getByText('owner console')).toBeTruthy();
    expect(screen.queryByText('Sana Guard could not load')).toBeNull();
    expect(
      errorSpy.mock.calls.some((call) => call[0] === 'vault-detail' && call[1] instanceof Error)
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('alert').textContent).toContain('post-action refresh failed');

    fireEvent.click(screen.getByRole('button', { name: 'Heal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('vault detail')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('logs a failure that has no transaction yet without inventing a link', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Harness txHash={null} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('post-action refresh failed');
    expect(alert.querySelector('a')).toBeNull();
    expect(screen.getByText('owner console')).toBeTruthy();
  });
});
