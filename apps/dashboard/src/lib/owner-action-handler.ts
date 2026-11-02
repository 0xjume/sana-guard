import { NextResponse } from 'next/server';
import {
  VAULT_LIMIT_UNAVAILABLE,
  checkCreateVaultLimits,
  ownerActionLimits,
  type CreateVaultLimitResult,
  type CreateVaultViews,
} from './create-vault-limits';
import { gateOwnerAction, readBearerToken, type PrivyVerifier } from './owner-gate';
import { trustedClientIp } from './rate-limit';
import type { RelayAdminResult } from './relay';

export type OwnerActionLog = (message: string, detail?: Record<string, string>) => void;

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function readOwnerActionPayload(body: unknown): {
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

export function logVaultLimitFailure(
  err: unknown,
  log: OwnerActionLog = console.error
): typeof VAULT_LIMIT_UNAVAILABLE {
  log('Vault limit check unavailable', {
    name: err instanceof Error ? err.name : 'Error',
    message: err instanceof Error ? err.message : 'unknown',
  });
  return VAULT_LIMIT_UNAVAILABLE;
}

export function ownerActionLimitsJson(
  env: Record<string, string | undefined> = process.env
): Pick<ReturnType<typeof ownerActionLimits>, 'maxVaultsPerOwner' | 'maxRelayVaultsTotal'> {
  return ownerActionLimits(env);
}

export async function handleOwnerActionPost(args: {
  request: Request;
  configError?: string | null;
  disableReason?: string | null;
  views: CreateVaultViews;
  postAdmin: (input: {
    message: string;
    signature: Uint8Array;
    owner: string;
    inviteToken?: string;
  }) => Promise<RelayAdminResult>;
  verify: PrivyVerifier;
  allowlist: string[] | null;
  env?: Record<string, string | undefined>;
  rateStore: Map<string, number[]>;
  ip?: string;
  logError?: OwnerActionLog;
}): Promise<NextResponse> {
  if (args.configError) {
    return NextResponse.json({ error: args.configError }, { status: 400 });
  }
  if (args.disableReason) {
    return NextResponse.json({ error: args.disableReason }, { status: 503 });
  }

  const payload = readOwnerActionPayload(await args.request.json().catch(() => null));
  if (!payload) {
    return NextResponse.json(
      { error: 'msg, owner, and 64-byte signature are required' },
      { status: 400 }
    );
  }
  const { message, owner, signature } = payload;
  const env = args.env ?? process.env;

  const gate = await gateOwnerAction({
    configured: true,
    accessToken: readBearerToken(args.request),
    owner,
    allowlist: args.allowlist,
    ip: args.ip ?? trustedClientIp(args.request.headers),
    rateStore: args.rateStore,
    verify: args.verify,
  });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  let createLimits: CreateVaultLimitResult;
  try {
    createLimits = await checkCreateVaultLimits({
      message,
      owner,
      views: args.views,
      env,
    });
  } catch (err) {
    return NextResponse.json(
      { error: logVaultLimitFailure(err, args.logError ?? console.error) },
      { status: 503 }
    );
  }
  if (!createLimits.ok) {
    return NextResponse.json(
      { error: createLimits.message, code: createLimits.code },
      { status: createLimits.status }
    );
  }

  const result = await args.postAdmin({
    message,
    signature,
    owner,
    inviteToken: env.INVITE_TOKEN?.trim() || undefined,
  });

  if (result.success) {
    return NextResponse.json(result);
  }
  return NextResponse.json(result, { status: result.error.httpStatus ?? 502 });
}
