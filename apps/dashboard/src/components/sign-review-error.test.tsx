/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignReviewProvider, useSignReview } from '@/components/sign-review';
import { reportOwnerSignProgress } from '@/lib/sign-progress';

const TX = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnb';

vi.mock('@/components/proof-link', () => ({
  ProofLink: ({ value }: { value: string }) => {
    throw new Error(`proof render failed for ${value}`);
  },
}));

function OpenReview() {
  const review = useSignReview();
  return (
    <button type="button" onClick={() => void review('raw owner message')}>
      Open review
    </button>
  );
}

describe('sign dialog render failure', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the console mounted and shows the tx link when confirming cannot render', async () => {
    render(
      <>
        <p>owner console</p>
        <SignReviewProvider>
          <OpenReview />
        </SignReviewProvider>
      </>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    });
    expect(screen.getByRole('button', { name: 'Sign with wallet' })).toBeTruthy();

    await act(async () => {
      reportOwnerSignProgress({ phase: 'confirming', txHash: TX });
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(`proof render failed for ${TX}`);
    const link = alert.querySelector('a');
    expect(link?.textContent).toBe(TX);
    expect(link?.getAttribute('href')).toContain(`/txns/${TX}`);
    expect(screen.getByText('owner console')).toBeTruthy();
    expect(screen.queryByText('Sana Guard could not load')).toBeNull();
    expect(screen.queryByText('A root-level error stopped the owner console.')).toBeNull();
    expect(
      vi
        .mocked(console.error)
        .mock.calls.some((call) => call[0] === 'sign-review' && call[1] instanceof Error)
    ).toBe(true);
  });
});
