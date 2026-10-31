import { Hono } from 'hono';
import type { NearClient } from '../near/interface.js';
import { createRequestLogger } from '../logger.js';
import { createReadRateLimit } from '../middleware/rateLimit.js';
import type { Config } from '../config.js';

export function createVaultsRouter(nearClient: NearClient, config: Config) {
  const app = new Hono();

  app.get('/v1/vaults/:id', createReadRateLimit(config), async (c) => {
    const log = createRequestLogger();

    try {
      const id = parseInt(c.req.param('id')!, 10);
      if (isNaN(id) || id < 0) {
        return c.json({ error: 'Invalid vault ID' }, 400);
      }

      log.info({ vaultId: id }, 'Fetching vault');
      const vault = await nearClient.getVault(id);

      if (!vault) {
        return c.json({ error: 'Vault not found' }, 404);
      }

      return c.json(vault);
    } catch (error: unknown) {
      log.error({ error }, 'Failed to fetch vault');
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  return app;
}
