import { publicConfig } from '@/lib/config';
import { handleOwnerTxGet } from '@/lib/owner-tx-handler';
import { parseOwnerAllowlist } from '@/lib/owner-gate';
import { ownerActionDisableReason, verifyPrivyAccessToken } from '@/lib/privy-session';
import { trustedClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rateStore = new Map<string, number[]>();

export async function GET(request: Request) {
  return handleOwnerTxGet({
    request,
    disableReason: ownerActionDisableReason(),
    verify: verifyPrivyAccessToken,
    allowlist: parseOwnerAllowlist(process.env.OWNER_ALLOWLIST),
    rateStore,
    ip: trustedClientIp(request.headers),
    relayUrl: publicConfig.relayUrl,
  });
}
