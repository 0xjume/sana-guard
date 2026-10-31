import { randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { GuardConfig } from './config.js';
import { createMcpServer } from './server.js';
import type { GuardRuntime } from './runtime.js';

export const HTTP_INTERNAL_ERROR = {
  jsonrpc: '2.0' as const,
  error: { code: -32603, message: 'Internal error' },
  id: null,
};

export interface SessionRecord<T> {
  value: T;
  createdAt: number;
  lastUsed: number;
}

export class BoundedSessionStore<T> {
  private readonly sessions = new Map<string, SessionRecord<T>>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {}

  get size(): number {
    this.evictExpired();
    return this.sessions.size;
  }

  get(id: string): T | undefined {
    const record = this.sessions.get(id);
    if (!record) {
      return undefined;
    }
    const now = this.now();
    if (now - record.lastUsed > this.ttlMs) {
      this.sessions.delete(id);
      return undefined;
    }
    record.lastUsed = now;
    return record.value;
  }

  set(id: string, value: T): void {
    this.evictExpired();
    while (this.sessions.size >= this.max && !this.sessions.has(id)) {
      const oldest = this.oldestId();
      if (!oldest) {
        break;
      }
      this.sessions.delete(oldest);
    }
    const now = this.now();
    this.sessions.set(id, { value, createdAt: now, lastUsed: now });
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  private evictExpired(): void {
    const now = this.now();
    for (const [id, record] of this.sessions) {
      if (now - record.lastUsed > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
  }

  private oldestId(): string | undefined {
    let oldest: string | undefined;
    let oldestAt = Infinity;
    for (const [id, record] of this.sessions) {
      if (record.lastUsed < oldestAt) {
        oldestAt = record.lastUsed;
        oldest = id;
      }
    }
    return oldest;
  }
}

export function normalizeHostHeader(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end === -1 ? trimmed : trimmed.slice(0, end + 1);
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon > -1 && /^\d+$/.test(trimmed.slice(colon + 1))) {
    return trimmed.slice(0, colon);
  }
  return trimmed;
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    const dummy = Buffer.alloc(b.length);
    if (b.length > 0) {
      timingSafeEqual(b, dummy);
    }
    return false;
  }
  return timingSafeEqual(a, b);
}

export function hostAllowed(hostHeader: string | undefined, allowedHosts: string[]): boolean {
  if (!hostHeader) {
    return false;
  }
  const host = normalizeHostHeader(hostHeader);
  const allowed = new Set(allowedHosts.map((item) => item.toLowerCase()));
  if (allowed.has(host)) {
    return true;
  }
  if (host.startsWith('[') && host.endsWith(']')) {
    return allowed.has(host.slice(1, -1));
  }
  return allowed.has(`[${host}]`);
}

export function originAllowed(origin: string, allowedHosts: string[]): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return hostAllowed(host, allowedHosts) || hostAllowed(`[${host}]`, allowedHosts);
  } catch {
    return false;
  }
}

export interface HttpAccessDenial {
  status: number;
  message: string;
}

export function evaluateHttpAccess(
  headers: { host?: string; origin?: string; authorization?: string },
  config: Pick<GuardConfig, 'httpToken' | 'httpAllowedHosts'>
): HttpAccessDenial | undefined {
  if (!hostAllowed(headers.host, config.httpAllowedHosts)) {
    return { status: 403, message: 'Forbidden host' };
  }
  if (
    headers.origin !== undefined &&
    headers.origin !== '' &&
    !originAllowed(headers.origin, config.httpAllowedHosts)
  ) {
    return { status: 403, message: 'Forbidden origin' };
  }
  if (!config.httpToken) {
    return { status: 401, message: 'Unauthorized' };
  }
  const authorization = headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    return { status: 401, message: 'Unauthorized' };
  }
  const presented = authorization.slice('Bearer '.length);
  if (!timingSafeEqualString(presented, config.httpToken)) {
    return { status: 401, message: 'Unauthorized' };
  }
  return undefined;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function createHttpApp(runtime: GuardRuntime, config: GuardConfig): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const transports = new BoundedSessionStore<StreamableHTTPServerTransport>(
    config.httpMaxSessions,
    config.httpSessionTtlMs
  );

  app.use((req, res, next) => {
    const host = headerString(req.headers.host);
    if (req.path === '/health') {
      if (!hostAllowed(host, config.httpAllowedHosts)) {
        res.status(403).json({ error: 'Forbidden host' });
        return;
      }
      next();
      return;
    }
    const denied = evaluateHttpAccess(
      {
        host,
        origin: headerString(req.headers.origin),
        authorization: headerString(req.headers.authorization),
      },
      config
    );
    if (denied) {
      res.status(denied.status).json({ error: denied.message });
      return;
    }
    next();
  });

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;

    try {
      if (existing) {
        await existing.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });
        transport.onclose = () => {
          const id = transport.sessionId;
          if (id) {
            transports.delete(id);
          }
        };
        const server = createMcpServer(runtime);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: no MCP session' },
        id: null,
      });
    } catch {
      if (!res.headersSent) {
        res.status(500).json(HTTP_INTERNAL_ERROR);
      }
    }
  });

  const sessionHandler = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send('Invalid or missing MCP session');
      return;
    }
    try {
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) {
        res.status(500).json(HTTP_INTERNAL_ERROR);
      }
    }
  };

  app.get('/mcp', sessionHandler);
  app.delete('/mcp', sessionHandler);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, name: 'sana-guard-mcp' });
  });

  return app;
}

export async function serveHttp(runtime: GuardRuntime, config: GuardConfig): Promise<void> {
  const app = createHttpApp(runtime, config);
  await new Promise<void>((resolve) => {
    app.listen(config.httpPort, config.httpHost, () => {
      console.error(`sana-guard MCP HTTP on http://${config.httpHost}:${config.httpPort}/mcp`);
      resolve();
    });
  });
}
