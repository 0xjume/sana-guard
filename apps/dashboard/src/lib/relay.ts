import { publicConfig } from './config';
import { explainGuardError, formatActionError, type GuardActionError } from './errors';
import { readPrivyAccessToken } from './privy-browser-token';

export interface RelayAdminSuccess {
  success: true;
  txHash: string;
  /** True until execution, including CreateVault's `vault_created` log, is observed. */
  pending?: boolean;
  vaultId?: number;
  depositYocto?: string;
  depositNear?: string | number;
}

export interface RelayAdminFailure {
  success: false;
  error: GuardActionError;
}

export type RelayAdminResult = RelayAdminSuccess | RelayAdminFailure;

export function readRelaySuccess(
  httpStatus: number,
  body: Record<string, unknown>
): RelayAdminSuccess | null {
  const txHash = typeof body.txHash === 'string' ? body.txHash : null;
  if (!txHash) {
    return null;
  }
  const vaultId =
    typeof body.vaultId === 'number' && Number.isInteger(body.vaultId) ? body.vaultId : undefined;
  const depositYocto = typeof body.depositYocto === 'string' ? body.depositYocto : undefined;
  const depositNear =
    typeof body.depositNear === 'string' || typeof body.depositNear === 'number'
      ? body.depositNear
      : undefined;
  if (body.pending === true) {
    return { success: true, pending: true, txHash, vaultId, depositYocto, depositNear };
  }
  if (httpStatus === 200 && body.success === true) {
    return { success: true, pending: false, txHash, vaultId, depositYocto, depositNear };
  }
  return null;
}

export async function postAdminToRelay(args: {
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
  const accepted = readRelaySuccess(response.status, body);
  if (accepted) {
    return accepted;
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

/**
 * Browser entry point. Posts to this app's /api/owner-action so INVITE_TOKEN
 * stays on the server.
 */
export async function submitOwnerAction(args: {
  message: string;
  signature: Uint8Array;
  owner: string;
}): Promise<RelayAdminResult> {
  const accessToken = await readPrivyAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch('/api/owner-action', {
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
          error instanceof Error
            ? `Dashboard route unreachable: ${error.message}`
            : 'Dashboard route unreachable',
      },
    };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const accepted = readRelaySuccess(response.status, body);
  if (accepted) {
    return accepted;
  }

  if (body.success === false && body.error && typeof body.error === 'object') {
    return body as unknown as RelayAdminFailure;
  }

  const explained = explainGuardError(body);
  explained.httpStatus = response.status;
  if (!explained.message) {
    explained.message = `Owner-action HTTP ${response.status}`;
  }
  return { success: false, error: explained };
}

export function relayErrorText(result: RelayAdminFailure): string {
  return formatActionError(result.error);
}
