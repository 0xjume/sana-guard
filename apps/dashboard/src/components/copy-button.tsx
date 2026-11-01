'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success('Copied to clipboard');
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}
