'use client';

import { SgMark } from '@/components/sg-mark';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card className="border-rejected-fill/40">
      <CardHeader>
        <div className="flex items-center gap-3">
          <SgMark size={36} />
          <p className="kicker">Error</p>
        </div>
        <CardTitle className="text-2xl">Something went wrong</CardTitle>
        <CardDescription>
          {error.message ||
            'The owner console hit an unexpected error. Your vaults and policy are unchanged.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
