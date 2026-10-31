import { publicConfig } from './config';
import { explainGuardError, formatActionError, type GuardActionError } from './errors';

export interface RelayAdminSuccess {
  success: true;
  txHash: string;
  depositYocto?: string;
  depositNear?: string | number;
}

export interface RelayAdminFailure {
  success: false;
  error: GuardActionError;
}

export type RelayAdminResult = RelayAdminSuccess | RelayAdminFailure;

export async function submitOwnerAction(args: {
  message: string;
  signature: Uint8Array;
  owner: string;
  inviteToken?: string;
  relayUrl?: string;
}): Promise<RelayAdminResult> {
  const relayUrl = (args.relayUrl ?? publicConfig.relayUrl).replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (args.inviteToken?.trim()) {
    headers['X-Invite-Token'] = args.inviteToken.trim();
  }

  let response: Response;
  try {
    response = await fetch(`${relayUrl}/v1/admin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        msg: args.message,
        signature: Array.from(args.signature),
        owner: args.owner,
      }),
    });
  } catch (error) {
    return {
      success: false,
      error: {
        message:
          error instanceof Error ? `Relay unreachable: ${error.message}` : 'Relay unreachable',
      },
    };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok && body.success === true && typeof body.txHash === 'string') {
    return {
      success: true,
      txHash: body.txHash,
      depositYocto: typeof body.depositYocto === 'string' ? body.depositYocto : undefined,
      depositNear:
        typeof body.depositNear === 'string' || typeof body.depositNear === 'number'
          ? body.depositNear
          : undefined,
    };
  }

  const explained = explainGuardError(body);
  explained.httpStatus = response.status;
  if (!explained.txHash && typeof body.txHash === 'string') {
    explained.txHash = body.txHash;
  }
  if (!explained.message) {
    explained.message = `Relay HTTP ${response.status}`;
  }
  return { success: false, error: explained };
}

export function relayErrorText(result: RelayAdminFailure): string {
  return formatActionError(result.error);
}
