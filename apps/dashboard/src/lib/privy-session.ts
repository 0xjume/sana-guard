import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTPayload } from 'jose';
import type { PrivySession } from './owner-gate';

const JWKS_CACHE = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function basicAuth(appId: string, secret: string): string {
  return `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`;
}

function walletAddressesFromUser(body: unknown): string[] {
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
    const chain = row.chainType ?? row.chain_type;
    if (chain === undefined || chain === 'solana') {
      addresses.push(row.address);
    }
  }
  return addresses;
}

async function verifyJwt(args: {
  token: string;
  appId: string;
  verificationKey?: string;
}): Promise<JWTPayload> {
  if (args.verificationKey) {
    const key = await importSPKI(args.verificationKey, 'ES256');
    const { payload } = await jwtVerify(args.token, key, {
      issuer: 'privy.io',
      audience: args.appId,
    });
    return payload;
  }
  const url = `https://auth.privy.io/api/v1/apps/${args.appId}/jwks.json`;
  let jwks = JWKS_CACHE.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    JWKS_CACHE.set(url, jwks);
  }
  const { payload } = await jwtVerify(args.token, jwks, {
    issuer: 'privy.io',
    audience: args.appId,
  });
  return payload;
}

export function privyOwnerActionConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() && env.PRIVY_APP_SECRET?.trim());
}

export async function verifyPrivyAccessToken(
  accessToken: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<PrivySession | null> {
  const appId = env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const secret = env.PRIVY_APP_SECRET?.trim();
  const verificationKey = env.PRIVY_VERIFICATION_KEY?.trim();
  if (!appId || !secret) {
    return null;
  }
  try {
    const payload = await verifyJwt({ token: accessToken, appId, verificationKey });
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) {
      return null;
    }
    const response = await fetch(
      `https://auth.privy.io/api/v1/users/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: basicAuth(appId, secret),
          Accept: 'application/json',
        },
      }
    );
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as unknown;
    return { userId, walletAddresses: walletAddressesFromUser(body) };
  } catch {
    return null;
  }
}
