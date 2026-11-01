import { NextResponse } from 'next/server';
import { fetchVaultActivity } from '@/lib/activity';
import { publicConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const vaultRaw = url.searchParams.get('vaultId');
  const vaultId = vaultRaw === null || vaultRaw === '' ? undefined : Number(vaultRaw);
  if (vaultId !== undefined && (!Number.isInteger(vaultId) || vaultId < 0)) {
    return NextResponse.json({ error: 'Invalid vaultId' }, { status: 400 });
  }

  const result = await fetchVaultActivity({
    accountId: publicConfig.guardContract,
    vaultId,
    network: publicConfig.nearNetwork,
  });

  return NextResponse.json(result);
}
