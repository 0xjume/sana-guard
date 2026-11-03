'use client';

import { useEffect } from 'react';
import { SgMark } from '@/components/sg-mark';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GENERIC_PAGE_ERROR, logUnexpectedError, publicErrorCopy } from '@/lib/error-display';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logUnexpectedError('app/error', error);
  }, [error]);

  const { message } = publicErrorCopy(error, GENERIC_PAGE_ERROR);

  return (
    <Card className="border-rejected-fill/40">
      <CardHeader>
        <div className="flex items-center gap-3">
          <SgMark size={36} />
          <p className="kicker">Error</p>
        </div>
        <CardTitle className="text-2xl">Something went wrong</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
