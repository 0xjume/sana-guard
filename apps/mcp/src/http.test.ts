import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { GuardConfig } from './config.js';
import {
  BoundedSessionStore,
  HTTP_INTERNAL_ERROR,
  createHttpApp,
  evaluateHttpAccess,
  hostAllowed,
  originAllowed,
  timingSafeEqualString,
} from './http.js';
import type { GuardRuntime } from './runtime.js';

const allowed = ['localhost', '127.0.0.1', '[::1]', '::1'];
const token = 'super-secret-http-token';
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

function request(
  port: number,
  headers: http.OutgoingHttpHeaders
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk as Buffer));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

describe('HTTP access', () => {
  it('requires a bearer token compared in constant time', () => {
    expect(timingSafeEqualString(token, token)).toBe(true);
    expect(timingSafeEqualString(token, 'other')).toBe(false);
    expect(
      evaluateHttpAccess(
        { host: '127.0.0.1:8787', authorization: `Bearer ${token}` },
        { httpToken: token, httpAllowedHosts: allowed }
      )
    ).toBeUndefined();
    expect(
      evaluateHttpAccess(
        { host: '127.0.0.1:8787' },
        { httpToken: token, httpAllowedHosts: allowed }
      )
    ).toEqual({ status: 401, message: 'Unauthorized' });
    expect(
      evaluateHttpAccess(
        { host: '127.0.0.1:8787', authorization: 'Bearer wrong-token' },
        { httpToken: token, httpAllowedHosts: allowed }
      )
    ).toEqual({ status: 401, message: 'Unauthorized' });
  });

  it('rejects Host: evil.attacker.example (DNS rebinding)', () => {
    expect(hostAllowed('evil.attacker.example', allowed)).toBe(false);
    expect(
      evaluateHttpAccess(
        { host: 'evil.attacker.example', authorization: `Bearer ${token}` },
        { httpToken: token, httpAllowedHosts: allowed }
      )
    ).toEqual({ status: 403, message: 'Forbidden host' });
    expect(hostAllowed('localhost:8787', allowed)).toBe(true);
    expect(hostAllowed('[::1]:8787', allowed)).toBe(true);
  });

  it('rejects a foreign Origin even when Host is loopback', () => {
    expect(originAllowed('https://evil.attacker.example', allowed)).toBe(false);
    expect(
      evaluateHttpAccess(
        {
          host: '127.0.0.1:8787',
          origin: 'https://evil.attacker.example',
          authorization: `Bearer ${token}`,
        },
        { httpToken: token, httpAllowedHosts: allowed }
      )
    ).toEqual({ status: 403, message: 'Forbidden origin' });
    expect(
      evaluateHttpAccess(
        {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:3333',
          authorization: `Bearer ${token}`,
        },
        { httpToken: token, httpAllowedHosts: allowed }
      )
    ).toBeUndefined();
  });

  it('does not put error.message into 500 bodies', () => {
    expect(HTTP_INTERNAL_ERROR.error.message).toBe('Internal error');
    expect(JSON.stringify(HTTP_INTERNAL_ERROR)).not.toContain('stack');
  });

  it('express app rejects evil Host/Origin and missing bearer', async () => {
    const config: GuardConfig = {
      nearNetwork: 'testnet',
      nearRpcUrl: 'https://rpc.testnet.near.org',
      guardContractId: 'guard.djume.testnet',
      agentAccountId: 'agent1.guard.djume.testnet',
      agentPrivateKey: 'secret',
      vaultId: 0,
      mpcContract: 'v1.signer-prod.testnet',
      mpcDomainId: 1,
      solanaRpcUrl: 'https://api.devnet.solana.com',
      allowMainnet: false,
      transport: 'http',
      httpHost: '127.0.0.1',
      httpPort: 0,
      httpToken: token,
      httpAllowPublic: false,
      httpAllowedHosts: allowed,
      httpMaxSessions: 8,
      httpSessionTtlMs: 30_000,
    };
    const app = createHttpApp({} as GuardRuntime, config);
    const server = await new Promise<http.Server>((resolve) => {
      const started = app.listen(0, '127.0.0.1', () => resolve(started));
    });
    servers.push(server);
    const { port } = server.address() as AddressInfo;

    const evilHost = await request(port, {
      host: 'evil.attacker.example',
      authorization: `Bearer ${token}`,
    });
    expect(evilHost.status).toBe(403);

    const foreignOrigin = await request(port, {
      host: '127.0.0.1',
      origin: 'https://evil.attacker.example',
      authorization: `Bearer ${token}`,
    });
    expect(foreignOrigin.status).toBe(403);

    const noAuth = await request(port, { host: '127.0.0.1' });
    expect(noAuth.status).toBe(401);

    const ok = await request(port, {
      host: '127.0.0.1',
      authorization: `Bearer ${token}`,
    });
    expect(ok.status).toBe(400);
    expect(ok.body).toContain('no MCP session');
  });
});

describe('BoundedSessionStore', () => {
  it('evicts the oldest session when full and expires by TTL', () => {
    let now = 1_000;
    const store = new BoundedSessionStore<string>(2, 50, () => now);
    store.set('a', 'A');
    now = 1_010;
    store.set('b', 'B');
    now = 1_020;
    store.set('c', 'C');
    expect(store.get('a')).toBeUndefined();
    expect(store.size).toBe(2);
    expect(store.get('b')).toBe('B');
    now = 1_080;
    expect(store.get('b')).toBeUndefined();
    expect(store.size).toBe(0);
  });
});
