import { Hono } from 'hono';
import { z } from 'zod';
import type { NearClient, VaultInfo } from '../near/interface.js';
import { sha256Hex, type RelayDatabase } from '../db.js';
import type { Config } from '../config.js';
import {
  parseAdminMessage,
  verifySignature,
  extractOwner,
  getVaultId,
  derivedKeyMatchesVaultAddress,
  createVaultDerivationPath,
  type ParsedAdminMessage,
} from '../validation.js';
import {
  calculateRequiredDeposit,
  calculateGas,
  estimateGasCostYocto,
  wouldBreachFloor,
} from '../budget.js';
import { yoctoToNearString } from '../constants.js';
import { createRequestLogger } from '../logger.js';
import { createAdminRateLimit, createTxStatusRateLimit } from '../middleware/rateLimit.js';
import { bodyLimit } from '../middleware/bodyLimit.js';
import { tokensEqual } from '../crypto.js';
import {
  isOnChainExecutionError,
  isPreAcceptanceRejection,
  isPreSignError,
  txHashFromUnknown,
} from '../near/errors.js';
import { spentAfterOutcome } from '../resolve.js';
import { parseOwnerVaultCount } from '../viewCount.js';

const adminRequestSchema = z.object({
  msg: z.string(),
  signature: z.array(z.number()).length(64),
  owner: z.string().optional(),
});

export function checkInviteGate(
  actionType: string,
  owner: string,
  inviteHeader: string | undefined,
  config: Config
): { allowed: boolean; reason?: string } {
  if (actionType !== 'CreateVault' && actionType !== 'AddAgent') {
    return { allowed: true };
  }

  if (!config.adminGateEnabled) {
    return { allowed: true };
  }

  const token = config.inviteToken?.trim();
  const allowlist = config.ownerAllowlist
    ?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (!token && (!allowlist || allowlist.length === 0)) {
    return {
      allowed: false,
      reason:
        'CreateVault/AddAgent are gated. Set INVITE_TOKEN and/or OWNER_ALLOWLIST, or ADMIN_GATE_ENABLED=false for private use.',
    };
  }

  if (token && !tokensEqual(inviteHeader ?? '', token)) {
    return { allowed: false, reason: 'Invalid or missing invite token' };
  }

  if (allowlist && allowlist.length > 0 && !allowlist.includes(owner)) {
    return { allowed: false, reason: 'Owner not in allowlist' };
  }

  return { allowed: true };
}

function parseOnChainError(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    const sgMatch = error.message.match(/SG_E\d+_[A-Z_]+/);
    if (sgMatch) return sgMatch[0]!;
  }
  return 'Transaction failed';
}

type ReserveOutcome =
  | { kind: 'ok' }
  | { kind: 'conflict' }
  | { kind: 'create-vault-conflict' }
  | { kind: 'reserve-fail'; reason: string }
  | {
      kind: 'bad';
      status: 400 | 401 | 403 | 404 | 503;
      error: string;
      extra?: Record<string, unknown>;
    };

function nonceConflictBody(): { error: string; code: 'NONCE_IN_FLIGHT' } {
  return {
    error: 'Request with same nonce already in progress',
    code: 'NONCE_IN_FLIGHT',
  };
}

function nonceReusedBody(): { error: string; code: 'NONCE_REUSED' } {
  return {
    error: 'This nonce is already in flight for a different signed message',
    code: 'NONCE_REUSED',
  };
}

function createVaultInFlightBody(): { error: string; code: 'CREATE_VAULT_IN_FLIGHT' } {
  return {
    error: 'CreateVault already in progress for this owner',
    code: 'CREATE_VAULT_IN_FLIGHT',
  };
}

function reserveFailCode(
  reason: string
): 'NONCE_REUSED' | 'NONCE_IN_FLIGHT' | 'LIMIT_EXCEEDED' | 'BUDGET_EXCEEDED' {
  if (reason === 'NONCE_REUSED') return 'NONCE_REUSED';
  if (reason.includes('nonce')) return 'NONCE_IN_FLIGHT';
  if (reason.toLowerCase().includes('limit')) return 'LIMIT_EXCEEDED';
  return 'BUDGET_EXCEEDED';
}

async function checkCreateVaultReservation(args: {
  db: RelayDatabase;
  nearClient: NearClient;
  config: Config;
  owner: string;
}): Promise<ReserveOutcome | null> {
  if (args.db.hasCreateVaultInFlight(args.owner)) {
    return { kind: 'create-vault-conflict' };
  }
  if (args.config.maxVaultsPerOwner === undefined) {
    return null;
  }

  let ownerVaultCount: number;
  try {
    ownerVaultCount = parseOwnerVaultCount(await args.nearClient.getOwnerVaultCount(args.owner));
  } catch {
    return {
      kind: 'bad',
      status: 503,
      error: 'Could not verify owner vault count',
      extra: { code: 'VAULT_COUNT_CHECK_FAILED' },
    };
  }
  if (ownerVaultCount >= args.config.maxVaultsPerOwner) {
    return {
      kind: 'bad',
      status: 403,
      error: 'Owner vault limit reached',
      extra: { code: 'VAULT_LIMIT' },
    };
  }
  return null;
}

async function reserveAdminRequest(args: {
  db: RelayDatabase;
  nearClient: NearClient;
  config: Config;
  owner: string;
  msg: string;
  parsedMsg: ParsedAdminMessage;
  vault: VaultInfo | null;
  onChainNonce: number;
  depositYocto: string;
  gasCostYocto: string;
  floorYocto: bigint;
  nowMs: number;
}): Promise<ReserveOutcome> {
  const {
    db,
    nearClient,
    config,
    owner,
    parsedMsg,
    vault,
    onChainNonce,
    depositYocto,
    gasCostYocto,
    floorYocto,
    nowMs,
  } = args;

  // Global lock wraps cheap re-validation + one view_account + the reserve.
  return db.withGlobalLock(async () =>
    db.withOwnerLock(owner, async () => {
      if (db.checkNonceInFlight(owner, parsedMsg.nonce)) {
        return { kind: 'conflict' };
      }

      if (parsedMsg.action.type === 'CreateVault') {
        const createVaultCheck = await checkCreateVaultReservation({
          db,
          nearClient,
          config,
          owner,
        });
        if (createVaultCheck) {
          return createVaultCheck;
        }
      }

      if (parsedMsg.action.type !== 'CreateVault') {
        if (!vault) {
          return { kind: 'bad', status: 404, error: 'Vault not found' };
        }
        if (vault.owner !== owner) {
          return { kind: 'bad', status: 401, error: 'Owner does not match vault' };
        }
      }

      if (parsedMsg.nonce <= onChainNonce) {
        return {
          kind: 'bad',
          status: 400,
          error: 'Nonce too old',
          extra: { provided: parsedMsg.nonce, onChainNonce },
        };
      }

      const relayBalance = await nearClient.getBalance();
      const available = (
        BigInt(relayBalance) - BigInt(db.getOutstandingReservedYocto())
      ).toString();
      if (wouldBreachFloor(available, depositYocto, gasCostYocto, floorYocto)) {
        return {
          kind: 'bad',
          status: 503,
          error: 'Service temporarily unavailable: transaction would breach balance floor',
          extra: { code: 'BALANCE_TOO_LOW' },
        };
      }

      const expiresAtMs = Number(parsedMsg.expiry / 1_000_000n);
      const result = db.tryReserveBudget({
        owner,
        nonce: parsedMsg.nonce,
        action: parsedMsg.action,
        depositYocto,
        gasCostYocto,
        nowMs,
        expiresAtMs,
        msgSha256: sha256Hex(args.msg),
        config,
      });
      if (!result.ok) {
        return { kind: 'reserve-fail', reason: result.reason };
      }
      return { kind: 'ok' };
    })
  );
}

export function createAdminRouter(nearClient: NearClient, db: RelayDatabase, config: Config) {
  const app = new Hono();

  app.post('/v1/admin', bodyLimit, createAdminRateLimit(config), async (c) => {
    const log = createRequestLogger();
    const nowMs = Date.now();

    try {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        log.warn('Malformed JSON body');
        return c.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
      }
      const parsed = adminRequestSchema.parse(body);
      const msg = parsed.msg;
      const signature = new Uint8Array(parsed.signature);

      log.info('Received admin request');

      let parsedMsg;
      try {
        parsedMsg = parseAdminMessage(msg);
      } catch (error: unknown) {
        log.warn({ error }, 'Message parsing failed');
        return c.json(
          {
            error: error instanceof Error ? error.message : 'Invalid message format',
          },
          400
        );
      }

      if (parsedMsg.network !== `near-${config.nearNetwork}`) {
        log.warn(
          { expected: `near-${config.nearNetwork}`, got: parsedMsg.network },
          'Network mismatch'
        );
        return c.json(
          {
            error: 'Invalid network',
            expected: `near-${config.nearNetwork}`,
            got: parsedMsg.network,
          },
          400
        );
      }

      if (parsedMsg.contract !== config.guardContractId) {
        log.warn(
          { expected: config.guardContractId, got: parsedMsg.contract },
          'Contract mismatch'
        );
        return c.json(
          {
            error: 'Invalid contract',
            expected: config.guardContractId,
            got: parsedMsg.contract,
          },
          400
        );
      }

      const nowNs = BigInt(Date.now()) * 1_000_000n;
      if (parsedMsg.expiry <= nowNs) {
        log.warn({ expiry: parsedMsg.expiry.toString() }, 'Message expired');
        return c.json({ error: 'Message expired' }, 400);
      }

      const vaultIdFromAction = getVaultId(parsedMsg.action);
      if (parsedMsg.action.type === 'CreateVault') {
        if (parsedMsg.vault !== null) {
          return c.json({ error: 'Vault header must be null for CreateVault' }, 400);
        }
      } else if (parsedMsg.vault !== vaultIdFromAction) {
        log.warn({ header: parsedMsg.vault, action: vaultIdFromAction }, 'Vault header mismatch');
        return c.json(
          {
            error: 'Vault header mismatch',
            expected: vaultIdFromAction,
            got: parsedMsg.vault,
          },
          400
        );
      }

      let owner: string;
      if (parsedMsg.action.type === 'CreateVault') {
        owner = extractOwner(parsedMsg.action);
        if (parsed.owner && parsed.owner !== owner) {
          return c.json({ error: 'Owner field does not match action' }, 400);
        }
      } else if (parsed.owner) {
        owner = parsed.owner;
      } else {
        return c.json(
          {
            error:
              'owner is required for this action so the signature can be verified before any RPC call',
          },
          400
        );
      }

      if (!verifySignature(msg, signature, owner)) {
        log.warn({ owner }, 'Invalid signature');
        return c.json({ error: 'Invalid signature' }, 401);
      }

      const inviteCheck = checkInviteGate(
        parsedMsg.action.type,
        owner,
        c.req.header('x-invite-token'),
        config
      );
      if (!inviteCheck.allowed) {
        log.warn({ reason: inviteCheck.reason }, 'Invite gate failed');
        return c.json({ error: inviteCheck.reason, code: 'ACCESS_DENIED' }, 403);
      }

      let depositYocto: string;
      try {
        depositYocto = calculateRequiredDeposit(parsedMsg.action, config);
      } catch (error: unknown) {
        log.warn({ error }, 'Deposit calculation failed');
        return c.json(
          {
            error: error instanceof Error ? error.message : 'Invalid action parameters',
          },
          400
        );
      }

      const gasAmount = calculateGas(parsedMsg.action);
      const gasCostYocto = estimateGasCostYocto(parsedMsg.action);
      const floorYocto = config.relayBalanceFloorYocto;

      if (db.checkNonceInFlight(owner, parsedMsg.nonce)) {
        const existing = db.getRequest(owner, parsedMsg.nonce);
        const open = existing?.status === 'pending' || existing?.status === 'unknown';
        const sameMessage = existing?.msgSha256 != null && existing.msgSha256 === sha256Hex(msg);
        if (existing?.txHash && open && sameMessage) {
          // Same signed message already has a broadcast hash. Resume that tx; do not sign another.
          log.info(
            { owner, nonce: parsedMsg.nonce, txHash: existing.txHash },
            'Resuming in-flight tx'
          );
          return c.json({ success: true, pending: true, txHash: existing.txHash });
        }
        if (open && existing?.msgSha256 != null && !sameMessage) {
          log.warn({ owner, nonce: parsedMsg.nonce }, 'Nonce reused for a different message');
          return c.json(nonceReusedBody(), 409);
        }
        if (existing?.txHash && open && !sameMessage) {
          // Legacy row with no stored hash, or a hash we cannot match. Do not hand back the old tx.
          log.warn({ owner, nonce: parsedMsg.nonce }, 'Nonce reused for a different message');
          return c.json(nonceReusedBody(), 409);
        }
        log.warn({ owner, nonce: parsedMsg.nonce }, 'Nonce already in flight');
        return c.json(nonceConflictBody(), 409);
      }

      if (parsedMsg.action.type === 'CreateVault' && db.hasCreateVaultInFlight(owner)) {
        log.warn({ owner }, 'CreateVault already in flight');
        return c.json(createVaultInFlightBody(), 409);
      }

      // Slow RPC views happen before the global lock.
      let vault: VaultInfo | null = null;
      if (parsedMsg.action.type !== 'CreateVault') {
        if (vaultIdFromAction === null) {
          return c.json({ error: 'Vault ID is required' }, 400);
        }
        vault = await nearClient.getVault(vaultIdFromAction);
        if (!vault) {
          return c.json({ error: 'Vault not found' }, 404);
        }
        if (vault.owner !== owner) {
          return c.json({ error: 'Owner does not match vault' }, 401);
        }
      }
      const onChainNonce = await nearClient.getOwnerNonce(owner);
      if (parsedMsg.nonce <= onChainNonce) {
        return c.json({ error: 'Nonce too old', provided: parsedMsg.nonce, onChainNonce }, 400);
      }

      if (parsedMsg.action.type === 'CreateVault') {
        let derived: string;
        let path: string;
        try {
          const ownerIndex = await nearClient.getOwnerVaultCount(owner);
          path = createVaultDerivationPath(owner, ownerIndex);
          derived = await nearClient.getDerivedPublicKey(path, config.guardContractId);
        } catch (error: unknown) {
          log.error({ error }, 'CreateVault MPC pre-check failed');
          return c.json(
            {
              error: 'Could not verify vault address',
              code: 'VAULT_ADDRESS_CHECK_FAILED',
            },
            503
          );
        }
        if (!derivedKeyMatchesVaultAddress(derived, parsedMsg.action.vault_address)) {
          log.warn({ path }, 'CreateVault address does not match MPC derivation');
          return c.json(
            {
              error: 'Vault address does not match MPC derivation',
              code: 'VAULT_ADDRESS_MISMATCH',
            },
            400
          );
        }
      }

      const reserved = await reserveAdminRequest({
        db,
        nearClient,
        config,
        owner,
        msg,
        parsedMsg,
        vault,
        onChainNonce,
        depositYocto,
        gasCostYocto,
        floorYocto,
        nowMs,
      });

      if (reserved.kind === 'conflict') {
        return c.json(nonceConflictBody(), 409);
      }
      if (reserved.kind === 'create-vault-conflict') {
        return c.json(createVaultInFlightBody(), 409);
      }
      if (reserved.kind === 'bad') {
        return c.json({ error: reserved.error, ...reserved.extra }, reserved.status);
      }
      if (reserved.kind === 'reserve-fail') {
        const code = reserveFailCode(reserved.reason);
        if (code === 'NONCE_REUSED') {
          return c.json(nonceReusedBody(), 409);
        }
        return c.json({ error: reserved.reason, code }, code === 'NONCE_IN_FLIGHT' ? 409 : 429);
      }

      log.info(
        { depositYocto, owner, nonce: parsedMsg.nonce, gas: gasAmount },
        'Submitting to NEAR'
      );

      return await db.withOwnerLock(owner, async () => {
        try {
          const result = await nearClient.submitOwnerAction(
            msg,
            parsed.signature,
            depositYocto,
            gasAmount,
            {
              onSigned: (txHash) => db.attachTxHash(owner, parsedMsg.nonce, txHash),
            }
          );

          if (result.pending) {
            db.markUnknown(owner, parsedMsg.nonce, result.txHash);
            log.info({ txHash: result.txHash }, 'Transaction broadcast; waiting for execution');
            return c.json({
              success: true,
              pending: true,
              txHash: result.txHash,
              depositYocto,
              depositNear: yoctoToNearString(depositYocto),
            });
          }

          const actualSpent = spentAfterOutcome({
            depositYocto,
            tokensBurntYocto: result.tokensBurntYocto,
            success: result.success,
          });

          db.reconcileBudget(
            owner,
            parsedMsg.nonce,
            actualSpent,
            result.txHash,
            result.success,
            nowMs
          );

          if (!result.success) {
            log.warn({ txHash: result.txHash, error: result.errorMessage }, 'Transaction failed');
            return c.json(
              {
                success: false,
                txHash: result.txHash,
                error: parseOnChainError({ message: result.errorMessage }),
              },
              400
            );
          }

          log.info({ txHash: result.txHash }, 'Transaction succeeded');
          return c.json({
            success: true,
            txHash: result.txHash,
            depositYocto,
            depositNear: yoctoToNearString(depositYocto),
          });
        } catch (error: unknown) {
          log.error({ error }, 'Submission failed');
          if (isPreSignError(error)) {
            db.releaseBudget(owner, parsedMsg.nonce, nowMs);
            return c.json(
              { error: 'Transaction could not be signed', code: 'PRE_SIGN_FAILED' },
              503
            );
          }
          if (isPreAcceptanceRejection(error)) {
            db.releaseBudget(owner, parsedMsg.nonce, nowMs);
            return c.json(
              { error: 'Transaction rejected before acceptance', code: 'TX_REJECTED' },
              400
            );
          }
          const broadcastHash = txHashFromUnknown(error);
          if (broadcastHash && isOnChainExecutionError(error)) {
            db.finalizeBudget(owner, parsedMsg.nonce, broadcastHash, false);
            return c.json(
              {
                success: false,
                txHash: broadcastHash,
                error: parseOnChainError(error),
              },
              400
            );
          }
          db.markUnknown(owner, parsedMsg.nonce, broadcastHash);
          return c.json(
            {
              error: 'Transaction status unknown; reservation held',
              pending: Boolean(broadcastHash),
              txHash: broadcastHash,
            },
            503
          );
        }
      });
    } catch (error: unknown) {
      log.error({ error }, 'Request processing failed');
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request' }, 400);
      }
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  app.get('/v1/admin/tx/:txHash', createTxStatusRateLimit(config), async (c) => {
    const txHash = c.req.param('txHash') ?? '';
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(txHash)) {
      return c.json({ error: 'Invalid transaction hash' }, 400);
    }
    const row = db.getRequestByTxHash(txHash);
    if (!row) {
      return c.json({ error: 'Unknown transaction' }, 404);
    }

    const withOwner = (body: Record<string, unknown>) => ({ ...body, owner: row.owner });

    if (row.status === 'released') {
      return c.json(
        withOwner({
          success: false,
          pending: false,
          txHash,
          error: 'This transaction was rejected before NEAR accepted it.',
          code: 'TX_REJECTED',
        }),
        400
      );
    }

    if (row.status === 'settled-unverified') {
      return c.json(
        withOwner({
          success: false,
          pending: false,
          unverified: true,
          txHash,
          error: 'Could not verify this transaction. Check the transaction link.',
          code: 'TX_UNVERIFIED',
        })
      );
    }

    const observed = await nearClient.getTransactionStatus(txHash);
    const open = row.status === 'pending' || row.status === 'unknown';

    if (!open) {
      if (row.success === 1) {
        return c.json(
          withOwner({
            success: true,
            pending: false,
            txHash,
            vaultId: observed.vaultId,
          })
        );
      }
      if (row.success === 0) {
        return c.json(
          withOwner({
            success: false,
            pending: false,
            txHash,
            error: observed.errorMessage ?? 'Transaction failed',
          }),
          400
        );
      }
      return c.json(
        withOwner({
          success: false,
          pending: false,
          unverified: true,
          txHash,
          error: 'Could not verify this transaction. Check the transaction link.',
          code: 'TX_UNVERIFIED',
        })
      );
    }

    if (observed.status === 'pending' || observed.status === 'unknown') {
      return c.json(withOwner({ success: true, pending: true, txHash }));
    }

    const actualSpent = spentAfterOutcome({
      depositYocto: row.depositYocto ?? '0',
      tokensBurntYocto: observed.tokensBurntYocto,
      success: observed.status === 'success',
    });
    db.reconcileBudget(
      row.owner,
      row.nonce,
      actualSpent,
      txHash,
      observed.status === 'success',
      Date.now()
    );

    if (observed.status === 'failure') {
      return c.json(
        withOwner({
          success: false,
          pending: false,
          txHash,
          error: observed.errorMessage ?? 'Transaction failed',
          code:
            observed.errorMessage === 'Vault verification failed'
              ? 'VAULT_VERIFICATION_FAILED'
              : undefined,
        }),
        400
      );
    }

    return c.json(
      withOwner({
        success: true,
        pending: false,
        txHash,
        vaultId: observed.vaultId,
      })
    );
  });

  return app;
}
