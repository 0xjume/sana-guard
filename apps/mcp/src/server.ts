import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandlers } from './tools.js';
import type { GuardRuntime } from './runtime.js';

const idempotencyKey = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .optional()
  .describe(
    '32-byte request id as 64 lowercase hex characters. Generated if omitted. Reuse the same key to retry the exact same request; a new key is a new request.'
  );

export function createMcpServer(runtime: GuardRuntime): McpServer {
  const handlers = createToolHandlers(runtime);
  const server = new McpServer({
    name: 'sana-guard',
    version: '0.1.0',
  });

  server.registerTool(
    'sana_guard_status',
    {
      title: 'Sana Guard vault status',
      description:
        'Read-only. Returns the agent NEAR account, vault Solana address, SOL/token balances, kill-switch (paused), vault state, and policy expiry. Call this before any spend. Never retries a policy rejection.',
      inputSchema: {},
    },
    async () => handlers.status()
  );

  server.registerTool(
    'sana_guard_get_policy',
    {
      title: 'Sana Guard vault policy',
      description:
        'Read-only. Returns per-tx limits, rolling 24h spent and remaining, recipient allowlist, and allowed programs. Amounts are integer strings. Use this to decide whether a transfer can pass.',
      inputSchema: {},
    },
    async () => handlers.getPolicy()
  );

  server.registerTool(
    'sana_guard_check_transfer',
    {
      title: 'Dry-run a Sana Guard transfer',
      description:
        'Dry-run only. Does not sign or broadcast. Checks pause, expiry, recipient allowlist (wallet for SOL, ATA for SPL), per-tx limit, 24h remaining, program allowlist, and the server max-per-call ceiling. Returns wouldPass plus reasons with SG_E### codes. If it fails, tell the user why and do not retry around policy.',
      inputSchema: {
        kind: z.enum(['sol', 'spl']).describe('sol for native SOL, spl for an SPL token transfer'),
        to: z
          .string()
          .describe(
            'Recipient Solana wallet address (base58). For SPL this is the token owner, not the ATA.'
          ),
        amount: z
          .string()
          .describe(
            'Amount in base units as a decimal integer string (lamports or token atoms). Never a float.'
          ),
        mint: z.string().optional().describe('SPL mint address (base58). Required when kind=spl.'),
      },
    },
    async (args) => handlers.checkTransfer(args)
  );

  server.registerTool(
    'sana_guard_transfer_sol',
    {
      title: 'Transfer SOL from the vault',
      description:
        'Builds a SystemProgram transfer, runs the same dry-run checks as sana_guard_check_transfer, then request_sign + broadcast on Solana. Requires an idempotencyKey (generated if omitted). Returns requestId, Solana signature, devnet/testnet explorer link, and broadcast status. On SG_E062/E067/E064/etc, do not retry with a different workaround.',
      inputSchema: {
        to: z.string().describe('Recipient Solana wallet (base58), must already be allowlisted.'),
        amount: z.string().describe('Lamports as a decimal integer string.'),
        memo: z.string().optional().describe('Optional memo (UTF-8). Must be within max_memo_len.'),
        idempotencyKey,
      },
    },
    async (args) => handlers.transferSol(args)
  );

  server.registerTool(
    'sana_guard_transfer_spl',
    {
      title: 'Transfer SPL tokens from the vault',
      description:
        'Builds a transferChecked to the recipient ATA. The ATA must already exist and be allowlisted (SG_E068 if you only allowlisted the wallet). Amount is base units as a string. Returns requestId, signature, explorer link, status. Do not create the ATA in this signed message.',
      inputSchema: {
        to: z.string().describe("Recipient wallet (base58). The vault sends to this wallet's ATA."),
        mint: z.string().describe('SPL mint address (base58).'),
        amount: z.string().describe('Token amount in base units as a decimal integer string.'),
        decimals: z
          .number()
          .int()
          .min(0)
          .max(18)
          .optional()
          .describe('Mint decimals. Fetched on-chain when omitted.'),
        memo: z.string().optional().describe('Optional memo (UTF-8).'),
        idempotencyKey,
      },
    },
    async (args) => handlers.transferSpl(args)
  );

  server.registerTool(
    'sana_guard_sign_transaction',
    {
      title: 'Sign an allowlisted Solana transaction',
      description:
        'Signs a serialized Solana transaction or message (base64) via request_sign after decoding every instruction, summing vault outflow (SOL system transfers + SPL transferChecked per mint) the same way the contract does, and running the policy pre-check plus server max-per-call. Rejects unknown programs, unchecked token transfers, and anything else that cannot be fully accounted for. Returns requestId, signature, explorer link, status, nearTxHash.',
      inputSchema: {
        transactionBase64: z
          .string()
          .describe(
            'Base64 of a legacy/v0 Solana transaction or raw message. No Address Lookup Tables.'
          ),
        idempotencyKey,
      },
    },
    async (args) => handlers.signTransaction(args)
  );

  server.registerTool(
    'sana_guard_get_request',
    {
      title: 'Look up a sign request',
      description:
        'Read-only. Fetch request_sign status by the 64-hex requestId returned from a write tool or SanaGuardSignError. Use this after a timeout instead of submitting a new request.',
      inputSchema: {
        requestId: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .describe('64 lowercase hex request id.'),
      },
    },
    async (args) => handlers.getRequest(args)
  );

  return server;
}
