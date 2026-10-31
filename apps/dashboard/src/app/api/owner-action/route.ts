import { NextResponse } from 'next/server';
import { publicConfig } from '@/lib/config';
import { postAdminToRelay } from '@/lib/relay';

export const runtime = 'nodejs';

/**
 * Browser owners POST here. The route attaches server-only INVITE_TOKEN so the
 * invite secret never enters the client bundle.
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
