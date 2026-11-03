import { NextResponse } from 'next/server';
import {
  AGENT_LIMIT_UNAVAILABLE,
  addAgentActionLimits,
  checkAddAgentLimits,
  isAddAgentAdminMessage,
  type AddAgentViews,
} from './add-agent-limits';
import {
  VAULT_LIMIT_UNAVAILABLE,
  checkCreateVaultLimits,
  isCreateVaultAdminMessage,
  ownerActionLimits,
  type CreateVaultViews,
} from './create-vault-limits';
import { gateOwnerAction, readBearerToken, type PrivyVerifier } from './owner-gate';
import { trustedClientIp } from './rate-limit';
import type { RelayAdminResult } from './relay';

export const DASH_CREATE_VAULT_IN_FLIGHT = 'DASH_CREATE_VAULT_IN_FLIGHT';
export const DASH_ADD_AGENT_IN_FLIGHT = 'DASH_ADD_AGENT_IN_FLIGHT';

export type OwnerActionLog = (message: string, detail?: Record<string, string>) => void;

export type OwnerActionViews = CreateVaultViews & AddAgentViews;

type OwnerLimitDenial = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

type OwnerLimitResult = { ok: true } | OwnerLimitDenial;

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
): ReturnType<typeof ownerActionLimits> & ReturnType<typeof addAgentActionLimits> {
  return {
    ...ownerActionLimits(env),
    ...addAgentActionLimits(env),
  };
}

function acquireOwnerGuard(inFlight: Set<string>, owner: string): boolean {
  if (inFlight.has(owner)) {
    return false;
  }
  inFlight.add(owner);
  return true;
}

function ownerLimitDenialResponse(result: OwnerLimitDenial): NextResponse {
  return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
}

function logAgentLimitFailure(
  err: unknown,
  log: OwnerActionLog = console.error
): typeof AGENT_LIMIT_UNAVAILABLE {
  log('Agent limit check unavailable', {
    name: err instanceof Error ? err.name : 'Error',
    message: err instanceof Error ? err.message : 'unknown',
  });
  return AGENT_LIMIT_UNAVAILABLE;
}

function ownerLimitUnavailableResponse(
  err: unknown,
  logError: OwnerActionLog,
  kind: 'vault' | 'agent'
): NextResponse {
  const error =
    kind === 'agent' ? logAgentLimitFailure(err, logError) : logVaultLimitFailure(err, logError);
  return NextResponse.json({ error }, { status: 503 });
}

async function enforceOwnerActionLimit(
  check: () => Promise<OwnerLimitResult>,
  logError: OwnerActionLog,
  kind: 'vault' | 'agent' = 'vault'
): Promise<NextResponse | null> {
  try {
    const result = await check();
    if (!result.ok) {
      return ownerLimitDenialResponse(result);
    }
    return null;
  } catch (err) {
    return ownerLimitUnavailableResponse(err, logError, kind);
  }
}

export async function handleOwnerActionPost(args: {
  request: Request;
  configError?: string | null;
  disableReason?: string | null;
  views: OwnerActionViews;
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
  createVaultInFlight?: Set<string>;
  addAgentInFlight?: Set<string>;
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
  const logError = args.logError ?? console.error;

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

  const createVaultInFlight = args.createVaultInFlight ?? new Set<string>();
  const addAgentInFlight = args.addAgentInFlight ?? new Set<string>();
  const holdingCreateVault = isCreateVaultAdminMessage(message);
  const holdingAddAgent = isAddAgentAdminMessage(message);
  if (holdingCreateVault && !acquireOwnerGuard(createVaultInFlight, owner)) {
    return NextResponse.json(
      {
        error: 'A CreateVault request is already in progress for this owner',
        code: DASH_CREATE_VAULT_IN_FLIGHT,
      },
      { status: 409 }
    );
  }
  if (holdingAddAgent && !acquireOwnerGuard(addAgentInFlight, owner)) {
    return NextResponse.json(
      {
        error: 'An AddAgent request is already in progress for this owner',
        code: DASH_ADD_AGENT_IN_FLIGHT,
      },
      { status: 409 }
    );
  }

  try {
    const createDenied = await enforceOwnerActionLimit(
      () => checkCreateVaultLimits({ message, owner, views: args.views, env }),
      logError,
      'vault'
    );
    if (createDenied) {
      return createDenied;
    }

    const addAgentDenied = await enforceOwnerActionLimit(
      () => checkAddAgentLimits({ message, views: args.views, env }),
      logError,
      'agent'
    );
    if (addAgentDenied) {
      return addAgentDenied;
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
  } finally {
    if (holdingCreateVault) {
      createVaultInFlight.delete(owner);
    }
    if (holdingAddAgent) {
      addAgentInFlight.delete(owner);
    }
  }
}
