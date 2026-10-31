import { NextResponse } from 'next/server';
import { publicConfig } from '@/lib/config';
import { gateOwnerAction, parseOwnerAllowlist, readBearerToken } from '@/lib/owner-gate';
import { privyOwnerActionConfigured, verifyPrivyAccessToken } from '@/lib/privy-session';
import { trustedClientIp } from '@/lib/rate-limit';
import { postAdminToRelay } from '@/lib/relay';

export const runtime = 'nodejs';

const rateStore = new Map<string, number[]>();

/**
 * Browser owners POST here. The route verifies a Privy access token, checks
 * the payload owner is a linked Solana wallet (and OWNER_ALLOWLIST when set),
 * then forwards to the relay. INVITE_TOKEN is attached only when set.
 */
export async function POST(request: Request) {
  if (publicConfig.configError) {
    return NextResponse.json({ error: publicConfig.configError }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    msg?: unknown;
    message?: unknown;
    signature?: unknown;
    owner?: unknown;
  } | null;

  const message =
    typeof body?.msg === 'string'
      ? body.msg
      : typeof body?.message === 'string'
        ? body.message
        : null;
  const owner = typeof body?.owner === 'string' ? body.owner : null;
  const signature = Array.isArray(body?.signature)
    ? Uint8Array.from(body.signature.map((item) => Number(item)))
    : null;

  if (!message || !owner || !signature || signature.length !== 64) {
    return NextResponse.json(
      { error: 'msg, owner, and 64-byte signature are required' },
      { status: 400 }
    );
  }

  const gate = await gateOwnerAction({
    configured: privyOwnerActionConfigured(),
    accessToken: readBearerToken(request),
    owner,
    allowlist: parseOwnerAllowlist(process.env.OWNER_ALLOWLIST),
    ip: trustedClientIp(request.headers),
    rateStore,
    verify: verifyPrivyAccessToken,
  });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await postAdminToRelay({
    message,
    signature,
    owner,
    inviteToken: process.env.INVITE_TOKEN?.trim() || undefined,
  });

  if (result.success) {
    return NextResponse.json(result);
  }
  return NextResponse.json(result, { status: result.error.httpStatus ?? 502 });
}
