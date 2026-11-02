import { NextResponse } from 'next/server';
import { publicConfig } from '@/lib/config';
import { checkCreateVaultLimits, type CreateVaultLimitResult } from '@/lib/create-vault-limits';
import { createViews } from '@/lib/near';
import { gateOwnerAction, parseOwnerAllowlist, readBearerToken } from '@/lib/owner-gate';
import { ownerActionDisableReason, verifyPrivyAccessToken } from '@/lib/privy-session';
import { trustedClientIp } from '@/lib/rate-limit';
import { postAdminToRelay } from '@/lib/relay';

export const runtime = 'nodejs';

const rateStore = new Map<string, number[]>();

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readOwnerActionPayload(body: unknown): {
  message: string;
  owner: string;
  signature: Uint8Array;
} | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as {
    msg?: unknown;
    message?: unknown;
    signature?: unknown;
    owner?: unknown;
  };
  const message = asString(record.msg) ?? asString(record.message);
  const owner = asString(record.owner);
  const signature = Array.isArray(record.signature)
    ? Uint8Array.from(record.signature.map((item) => Number(item)))
    : null;
  if (!message || !owner || !signature || signature.length !== 64) {
    return null;
  }
  return { message, owner, signature };
}

function vaultCountUnavailableMessage(err: unknown): string {
  const prefix = 'Could not read vault counts from the guard contract';
  return err instanceof Error ? `${prefix}: ${err.message}` : prefix;
}

/**
 * Browser owners POST here. The route verifies a Privy access token, checks
 * the payload owner is a linked Solana wallet (and OWNER_ALLOWLIST when set),
 * then forwards to the relay. OWNER_ALLOWLIST is optional: unset means any
 * authenticated Privy user with a linked Solana wallet may act.
 */
export async function POST(request: Request) {
  if (publicConfig.configError) {
    return NextResponse.json({ error: publicConfig.configError }, { status: 400 });
  }

  const disabled = ownerActionDisableReason();
  if (disabled) {
    return NextResponse.json({ error: disabled }, { status: 503 });
  }

  const payload = readOwnerActionPayload(await request.json().catch(() => null));
  if (!payload) {
    return NextResponse.json(
      { error: 'msg, owner, and 64-byte signature are required' },
      { status: 400 }
    );
  }
  const { message, owner, signature } = payload;

  const gate = await gateOwnerAction({
    configured: true,
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

  let createLimits: CreateVaultLimitResult;
  try {
    createLimits = await checkCreateVaultLimits({
      message,
      owner,
      views: createViews(),
    });
  } catch (err) {
    return NextResponse.json({ error: vaultCountUnavailableMessage(err) }, { status: 503 });
  }
  if (!createLimits.ok) {
    return NextResponse.json(
      { error: createLimits.message, code: createLimits.code },
      { status: createLimits.status }
    );
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
