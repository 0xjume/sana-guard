import { NextResponse } from 'next/server';
import { gateOwnerAction, readBearerToken, type PrivyVerifier } from './owner-gate';
import { trustedClientIp } from './rate-limit';

export const OWNER_TX_MAX_PER_KEY = 120;
export const OWNER_TX_BUCKET = 'owner-tx:';

const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,100}$/;

export async function handleOwnerTxGet(args: {
  request: Request;
  disableReason?: string | null;
  verify: PrivyVerifier;
  allowlist: string[] | null;
  rateStore: Map<string, number[]>;
  ip?: string;
  relayUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<NextResponse> {
  if (args.disableReason) {
    return NextResponse.json({ error: args.disableReason }, { status: 503 });
  }

  const url = new URL(args.request.url);
  const txHash = url.searchParams.get('txHash') ?? '';
  const owner = url.searchParams.get('owner') ?? '';
  if (!owner || !TX_HASH.test(txHash)) {
    return NextResponse.json({ error: 'txHash and owner are required' }, { status: 400 });
  }

  const gate = await gateOwnerAction({
    configured: true,
    accessToken: readBearerToken(args.request),
    owner,
    allowlist: args.allowlist,
    ip: args.ip ?? trustedClientIp(args.request.headers),
    rateStore: args.rateStore,
    verify: args.verify,
    maxPerKey: OWNER_TX_MAX_PER_KEY,
    bucket: OWNER_TX_BUCKET,
  });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const relayUrl = args.relayUrl.replace(/\/$/, '');
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${relayUrl}/v1/admin/tx/${encodeURIComponent(txHash)}`, {
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'Relay unreachable', txHash }, { status: 503 });
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.owner === 'string' && body.owner !== owner) {
    return NextResponse.json({ error: 'Unknown transaction' }, { status: 404 });
  }
  return NextResponse.json(body, { status: response.status });
}
