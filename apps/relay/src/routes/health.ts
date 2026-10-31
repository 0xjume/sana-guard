import { Hono } from 'hono';
import type { NearClient } from '../near/interface.js';
import type { Config } from '../config.js';
import { yoctoToNearString } from '../constants.js';
import { createReadRateLimit } from '../middleware/rateLimit.js';

export function createHealthRouter(nearClient: NearClient, config: Config) {
  const app = new Hono();

  app.get('/v1/health', createReadRateLimit(config), async (c) => {
    try {
      const balance = await nearClient.getBalance();
      const healthy = BigInt(balance) >= config.relayBalanceFloorYocto;

      const status = {
        status: healthy ? 'healthy' : 'degraded',
        relayBalanceNear: yoctoToNearString(balance),
        relayBalanceFloor: yoctoToNearString(config.relayBalanceFloorYocto),
        network: config.nearNetwork,
        guardContract: config.guardContractId,
      };

      return c.json(status, healthy ? 200 : 503);
    } catch {
      return c.json({ status: 'unhealthy', error: 'Health check failed' }, 503);
    }
  });

  return app;
}
