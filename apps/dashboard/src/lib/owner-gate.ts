import { allowRateLimited } from './rate-limit';

export interface PrivySession {
  userId: string;
  walletAddresses: string[];
}

export type PrivyVerifier = (accessToken: string) => Promise<PrivySession | null>;

export const OWNER_ACTION_WINDOW_MS = 60_000;
export const OWNER_ACTION_MAX_PER_KEY = 8;

export function parseOwnerAllowlist(raw: string | undefined | null): string[] | null {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return null;
  }
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items;
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) {
    return null;
  }
  const match = header.match(/^Bearer\s+(\S+)/i);
  return match?.[1] ?? null;
}

export function ownerLinkedToSession(owner: string, session: PrivySession): boolean {
  return session.walletAddresses.some((address) => address === owner);
}

export function ownerOnAllowlist(owner: string, allowlist: string[] | null): boolean {
  if (allowlist === null) {
    return true;
  }
  return allowlist.includes(owner);
}

export type OwnerGateDenial = { ok: false; status: 401 | 403 | 429 | 503; error: string };
export type OwnerGateOk = { ok: true };

export function decideOwnerGate(args: {
  configured: boolean;
  accessToken: string | null;
  session: PrivySession | null;
  owner: string;
  allowlist: string[] | null;
  ip: string;
  rateStore: Map<string, number[]>;
  now?: number;
}): OwnerGateOk | OwnerGateDenial {
  if (!args.configured) {
    return {
      ok: false,
      status: 503,
      error:
        'Owner actions are disabled until NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET are set.',
    };
  }
  if (!args.accessToken || !args.session) {
    return { ok: false, status: 401, error: 'No session' };
  }
  if (!ownerLinkedToSession(args.owner, args.session)) {
    return { ok: false, status: 403, error: 'Owner mismatch' };
  }
  if (!ownerOnAllowlist(args.owner, args.allowlist)) {
    return { ok: false, status: 403, error: 'Owner is not on OWNER_ALLOWLIST' };
  }
  const now = args.now ?? Date.now();
  if (
    !allowRateLimited(
      args.rateStore,
      `ip:${args.ip}`,
      now,
      OWNER_ACTION_WINDOW_MS,
      OWNER_ACTION_MAX_PER_KEY
    ) ||
    !allowRateLimited(
      args.rateStore,
      `owner:${args.owner}`,
      now,
      OWNER_ACTION_WINDOW_MS,
      OWNER_ACTION_MAX_PER_KEY
    )
  ) {
    return { ok: false, status: 429, error: 'Rate limited' };
  }
  return { ok: true };
}

export async function gateOwnerAction(args: {
  configured: boolean;
  accessToken: string | null;
  owner: string;
  allowlist: string[] | null;
  ip: string;
  rateStore: Map<string, number[]>;
  verify: PrivyVerifier;
  now?: number;
}): Promise<OwnerGateOk | OwnerGateDenial> {
  let session: PrivySession | null = null;
  if (args.configured && args.accessToken) {
    session = await args.verify(args.accessToken);
  }
  return decideOwnerGate({
    configured: args.configured,
    accessToken: args.accessToken,
    session,
    owner: args.owner,
    allowlist: args.allowlist,
    ip: args.ip,
    rateStore: args.rateStore,
    now: args.now,
  });
}
