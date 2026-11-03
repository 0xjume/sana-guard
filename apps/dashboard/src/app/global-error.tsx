'use client';

import { useEffect } from 'react';
import { GENERIC_ROOT_ERROR, logUnexpectedError, publicErrorCopy } from '@/lib/error-display';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logUnexpectedError('app/global-error', error);
  }, [error]);

  const { message } = publicErrorCopy(error, GENERIC_ROOT_ERROR);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#121614',
          color: '#ebebeb',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <main style={{ maxWidth: 720, margin: '0 auto', padding: '4rem 1rem' }}>
          <p
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#b8b8b8',
            }}
          >
            Error
          </p>
          <h1 style={{ fontSize: '1.5rem', margin: '0.75rem 0 0' }}>Sana Guard could not load</h1>
          <p style={{ color: '#b8b8b8', lineHeight: 1.6 }}>{message}</p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              height: 40,
              padding: '0 1.25rem',
              border: 0,
              borderRadius: 999,
              background: '#50d75e',
              color: '#090f0a',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
