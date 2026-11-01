'use client';

import { Mail } from 'lucide-react';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { SgMark } from '@/components/sg-mark';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function GatewayLogin() {
  const session = useOwnerSession();

  return (
    <div className="flex min-h-[70vh] items-center justify-center py-8">
      <Card className="w-full max-w-md shadow-e2">
        <CardContent className="p-8">
          <div className="flex items-center justify-between">
            <SgMark size={40} />
            <span className="font-heading text-sm font-semibold tracking-tight">Sana Guard</span>
          </div>
          <h1 className="mt-8 font-heading text-3xl font-semibold tracking-tight">
            Welcome to Gateway
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Sign in with your email. A self-custodial Solana wallet is created for you in seconds.
          </p>
          <Button
            type="button"
            size="pill"
            className="mt-8 w-full"
            onClick={session.login}
            disabled={!session.ready}
          >
            <Mail className="h-4 w-4" />
            Continue with Email
          </Button>
          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            Self-custodial wallet powered by Privy. Your keys never leave your browser.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
