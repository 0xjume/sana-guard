import { NextResponse } from 'next/server';
import { publicConfig } from '@/lib/config';
import { createViews } from '@/lib/near';
import { handleOwnerActionPost, ownerActionLimitsJson } from '@/lib/owner-action-handler';
import { parseOwnerAllowlist } from '@/lib/owner-gate';
import { ownerActionDisableReason, verifyPrivyAccessToken } from '@/lib/privy-session';
import { trustedClientIp } from '@/lib/rate-limit';
import { postAdminToRelay } from '@/lib/relay';

export const runtime = 'nodejs';

const rateStore = new Map<string, number[]>();
const createVaultInFlight = new Set<string>();
const addAgentInFlight = new Set<string>();

/**
 * Public demo limits. Caps are server-only; the UI reads them here so
 * create-vault and AddAgent disable use the same values as POST /api/owner-action.
 */
export async function GET() {
  return NextResponse.json(ownerActionLimitsJson());
}

/**
 * Browser owners POST here. The route verifies a Privy access token, checks
 * the payload owner is a linked Solana wallet (and OWNER_ALLOWLIST when set),
 * then forwards to the relay. OWNER_ALLOWLIST is optional: unset means any
 * authenticated Privy user with a linked Solana wallet may act.
 */
export async function POST(request: Request) {
  return handleOwnerActionPost({
    request,
    configError: publicConfig.configError,
    disableReason: ownerActionDisableReason(),
    views: createViews(),
    postAdmin: postAdminToRelay,
    verify: verifyPrivyAccessToken,
    allowlist: parseOwnerAllowlist(process.env.OWNER_ALLOWLIST),
    env: process.env,
    rateStore,
    createVaultInFlight,
    addAgentInFlight,
    ip: trustedClientIp(request.headers),
    logError: console.error,
  });
}
