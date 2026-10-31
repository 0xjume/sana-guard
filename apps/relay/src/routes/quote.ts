import { Hono } from 'hono';
import { createRequestLogger } from '../logger.js';
import {
  CREATE_VAULT_DEPOSIT,
  GAS_100_TGAS,
  GAS_150_TGAS,
  parseNearToYocto,
  yoctoToNearString,
  maxGasCostYocto,
} from '../constants.js';
import { addAgentDeposit, maxAgentFundingYocto } from '../budget.js';
import { createReadRateLimit } from '../middleware/rateLimit.js';
import type { Config } from '../config.js';

const ZERO_DEPOSIT_ACTIONS = new Set([
  'AddRecipient',
  'RemoveRecipient',
  'BackfillRecipients',
  'RemoveAgent',
  'SetPolicy',
  'Pause',
  'Unpause',
  'RegisterTokenAccount',
  'Release',
]);

export function createQuoteRouter(config?: Config) {
  const app = new Hono();
  const limiter = createReadRateLimit(
    config ?? { trustProxy: false, trustProxyHops: 1, clientIpHeader: undefined }
  );

  app.get('/v1/quote/:action', limiter, async (c) => {
    const log = createRequestLogger();

    try {
      const action = c.req.param('action')!;
      log.info({ action }, 'Quote request');

      let depositYocto = '0';
      let gasUnits = GAS_100_TGAS;

      switch (action) {
        case 'CreateVault':
          depositYocto = CREATE_VAULT_DEPOSIT.toString();
          break;
        case 'AddAgent': {
          const yoctoParam = c.req.query('gas_funding_yocto');
          const nearParam = c.req.query('gas_funding');
          if (!yoctoParam && !nearParam) {
            return c.json(
              {
                error:
                  'gas_funding (NEAR) or gas_funding_yocto query parameter required for AddAgent',
              },
              400
            );
          }

          let gasFundingYocto: bigint;
          try {
            gasFundingYocto = yoctoParam
              ? parseNearToYocto(yoctoParam, 'yocto')
              : parseNearToYocto(nearParam!, 'near');
          } catch {
            return c.json({ error: 'Invalid gas_funding value' }, 400);
          }

          try {
            const max = config ? maxAgentFundingYocto(config) : undefined;
            depositYocto = addAgentDeposit(gasFundingYocto, max);
          } catch (error: unknown) {
            return c.json(
              {
                error: error instanceof Error ? error.message : 'Invalid gas_funding value',
              },
              400
            );
          }
          gasUnits = GAS_150_TGAS;
          break;
        }
        default:
          if (!ZERO_DEPOSIT_ACTIONS.has(action)) {
            return c.json({ error: 'Unknown action type' }, 400);
          }
      }

      const estimatedGasYocto = maxGasCostYocto(gasUnits).toString();
      const totalYocto = (BigInt(depositYocto) + BigInt(estimatedGasYocto)).toString();

      return c.json({
        action,
        depositNear: yoctoToNearString(depositYocto),
        depositYocto,
        estimatedGasNear: yoctoToNearString(estimatedGasYocto),
        estimatedGasYocto,
        totalYocto,
        totalNear: yoctoToNearString(totalYocto),
      });
    } catch (error: unknown) {
      log.error({ error }, 'Quote request failed');
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  return app;
}
