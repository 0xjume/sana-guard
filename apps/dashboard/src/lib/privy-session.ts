import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTPayload } from 'jose';
import { parseOwnerAllowlist } from './owner-gate';
import type { PrivySession } from './owner-gate';

const JWKS_CACHE = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const PRIVY_USERS_ORIGIN = 'https://api.privy.io/v1/users';

function basicAuth(appId: string, secret: string): string {
  return `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`;
}

export function jwtVerifyOptions(appId: string) {
  return {
    issuer: 'privy.io',
    audience: appId,
    algorithms: ['ES256'],
    requiredClaims: ['exp', 'sub'],
  };
}

export function privyUserRequest(
  userId: string,
  appId: string,
  secret: string
): { url: string; headers: Record<string, string> } {
  return {
    url: `${PRIVY_USERS_ORIGIN}/${encodeURIComponent(userId)}`,
    headers: {
      Authorization: basicAuth(appId, secret),
      'privy-app-id': appId,
      Accept: 'application/json',
    },
  };
}

export function walletAddressesFromUser(body: unknown): string[] {
  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const accounts = Array.isArray(root?.linked_accounts)
    ? root.linked_accounts
    : Array.isArray(root?.linkedAccounts)
      ? root.linkedAccounts
      : [];
  const addresses: string[] = [];
  for (const account of accounts) {
    if (!account || typeof account !== 'object') {
      continue;
    }
    const row = account as Record<string, unknown>;
    if (row.type !== 'wallet' || typeof row.address !== 'string') {
      continue;
    }
    const chain = row.chain_type ?? row.chainType;
    if (chain === 'solana') {
      addresses.push(row.address);
    }
  }
  return addresses;
}

export type VerifyJwtFn = (args: {
  token: string;
  appId: string;
  verificationKey?: string;
}) => Promise<JWTPayload>;

export async function verifyJwt(args: {
  token: string;
  appId: string;
  verificationKey?: string;
}): Promise<JWTPayload> {
  const options = jwtVerifyOptions(args.appId);
  if (args.verificationKey) {
    const key = await importSPKI(args.verificationKey, 'ES256');
    const { payload } = await jwtVerify(args.token, key, options);
    return payload;
  }
  const url = `https://auth.privy.io/api/v1/apps/${args.appId}/jwks.json`;
  let jwks = JWKS_CACHE.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    JWKS_CACHE.set(url, jwks);
  }
  const { payload } = await jwtVerify(args.token, jwks, options);
  return payload;
}

export function ownerActionDisableReason(
  env: Record<string, string | undefined> = process.env
): string | null {
  if (!env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || !env.PRIVY_APP_SECRET?.trim()) {
    return 'Owner actions are disabled until NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET are set.';
  }
  if (env.INVITE_TOKEN?.trim() && parseOwnerAllowlist(env.OWNER_ALLOWLIST) === null) {
    return 'INVITE_TOKEN is set; set OWNER_ALLOWLIST (comma-separated owner pubkeys) before enabling owner actions.';
  }
  return null;
}

export function privyOwnerActionConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  return ownerActionDisableReason(env) === null;
}

export async function verifyPrivyAccessToken(
  accessToken: string,
  env: Record<string, string | undefined> = process.env,
  deps: { fetchImpl?: typeof fetch; verifyJwtImpl?: VerifyJwtFn } = {}
): Promise<PrivySession | null> {
  const appId = env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const secret = env.PRIVY_APP_SECRET?.trim();
  const verificationKey = env.PRIVY_VERIFICATION_KEY?.trim();
  if (!appId || !secret) {
    return null;
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const verifyJwtImpl = deps.verifyJwtImpl ?? verifyJwt;
  try {
    const payload = await verifyJwtImpl({ token: accessToken, appId, verificationKey });
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) {
      return null;
    }
    const request = privyUserRequest(userId, appId, secret);
    const response = await fetchImpl(request.url, { headers: request.headers });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as unknown;
    return { userId, walletAddresses: walletAddressesFromUser(body) };
  } catch {
    return null;
  }
}
