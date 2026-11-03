'use client';

import { Mail, Wallet } from 'lucide-react';
import { SgMark } from '@/components/sg-mark';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function OwnerSignInCard({
  ready = true,
  onSignIn,
}: {
  ready?: boolean;
  onSignIn?: () => void;
}) {
  return (
    <div className="flex justify-center py-4">
      <Card className="w-full max-w-md shadow-e2">
        <CardContent className="p-8">
          <div className="flex items-center justify-between">
            <SgMark size={40} />
            <span className="font-heading text-sm font-semibold tracking-tight">Sana Guard</span>
          </div>
          <h1 className="mt-8 font-heading text-3xl font-semibold tracking-tight">Owner sign-in</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Authenticate with email or a Solana wallet. Privy opens an owner wallet so you can sign
            policy, agent, and kill-switch actions.
          </p>
          <Button
            type="button"
            size="pill"
            className="mt-8 w-full"
            onClick={onSignIn}
            disabled={!ready || !onSignIn}
          >
            <Mail className="h-4 w-4" />
            <Wallet className="h-4 w-4" />
            Sign in with email or wallet
          </Button>
          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            Embedded Solana wallets are created by Privy when you sign in without an existing
            wallet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
