import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { connect, keyStores, KeyPair, type Account as NearAccount } from 'near-api-js';
import { AgentClient, createSanaGuardError, parseErrorCode } from '@sana-guard/sdk';
import {
  ATTACK_EXPECTED,
  ATTACK_KINDS,
  buildAttackMessage,
  replayIdempotencyKey,
} from '@/lib/attack-lab';
import { publicConfig } from '@/lib/config';
import { createViews } from '@/lib/near';
import type { AttackKind } from '@/lib/attack-lab';

export const runtime = 'nodejs';

interface DemoAgentConfig {
  accountId: string;
  privateKey: string;
}

function demoAgentConfig(): DemoAgentConfig | null {
  const accountId = process.env.DEMO_AGENT_ACCOUNT_ID?.trim();
  const privateKey = process.env.DEMO_AGENT_PRIVATE_KEY?.trim();
  if (!accountId || !privateKey) {
    return null;
  }
  return { accountId, privateKey };
}

function isAttackKind(value: unknown): value is AttackKind {
  return typeof value === 'string' && (ATTACK_KINDS as string[]).includes(value);
}

async function connectAgent(config: DemoAgentConfig): Promise<NearAccount> {
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(config.privateKey as `ed25519:${string}`);
  await keyStore.setKey(publicConfig.nearNetwork, config.accountId, keyPair);
  const near = await connect({
    networkId: publicConfig.nearNetwork,
    nodeUrl: publicConfig.nearRpcUrl,
    keyStore,
  });
  return near.account(config.accountId);
}

function errorPayload(error: unknown): { message: string; code?: string } {
  const mapped = createSanaGuardError(error instanceof Error ? error.message : String(error));
  const code = mapped.code ?? parseErrorCode(mapped.message) ?? undefined;
  return { message: mapped.message, code };
}

export async function GET() {
  return NextResponse.json({
    enabled: demoAgentConfig() !== null,
    documented:
      'Attack Lab runs on this Next.js server route so agent keys never enter the browser bundle. Set DEMO_AGENT_ACCOUNT_ID and DEMO_AGENT_PRIVATE_KEY. The route calls request_sign on the live guard with policy-violating messages built by the SDK.',
  });
}

export async function POST(request: Request) {
  const demo = demoAgentConfig();
  if (!demo) {
    return NextResponse.json(
      {
        enabled: false,
        error:
          'Attack Lab is disabled. Set DEMO_AGENT_ACCOUNT_ID and DEMO_AGENT_PRIVATE_KEY on the server. Agent keys are never sent to the browser.',
      },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    kind?: unknown;
    vaultId?: unknown;
  } | null;
  if (!body || !isAttackKind(body.kind)) {
    return NextResponse.json({ error: 'kind is required' }, { status: 400 });
  }

  const vaultId =
    typeof body.vaultId === 'number'
      ? body.vaultId
      : Number(process.env.DEMO_AGENT_VAULT_ID ?? '0');
  if (!Number.isInteger(vaultId) || vaultId < 0) {
    return NextResponse.json({ error: 'Invalid vaultId' }, { status: 400 });
  }

  const views = createViews();
  const vault = await views.getVault(vaultId);
  if (!vault) {
    return NextResponse.json({ error: 'Vault not found' }, { status: 404 });
  }

  const recipients = await views.getRecipients(vaultId);
  const connection = new Connection(publicConfig.solanaRpcUrl, 'confirmed');
  const latest = await connection.getLatestBlockhash('confirmed');
  const message = buildAttackMessage({
    kind: body.kind,
    vaultAddress: vault.vaultAddress,
    recentBlockhash: latest.blockhash,
    policy: vault.policy,
    allowlistedRecipient: recipients[0],
  });

  const account = await connectAgent(demo);
  const client = new AgentClient(
    connection,
    account,
    publicConfig.guardContract,
    new PublicKey(vault.vaultAddress)
  );

  const idempotencyKey = body.kind === 'replay_idempotency' ? replayIdempotencyKey() : undefined;

  const attempts: Array<{ pass: number; result: Record<string, unknown> }> = [];
  const passes = body.kind === 'replay_idempotency' ? 2 : 1;

  for (let pass = 1; pass <= passes; pass += 1) {
    try {
      await client.requestSign({
        vaultId,
        message,
        idempotencyKey,
      });
      attempts.push({
        pass,
        result: { unexpected: 'request_sign succeeded; the guard should have rejected this' },
      });
    } catch (error) {
      attempts.push({ pass, result: errorPayload(error) });
    }
  }

  return NextResponse.json({
    enabled: true,
    kind: body.kind,
    expected: ATTACK_EXPECTED[body.kind],
    vaultId,
    attempts,
    note:
      body.kind === 'replay_idempotency'
        ? 'SG_E059 only fires after a request id was accepted. A policy-violating first attempt does not store the id; the second attempt then fails at policy again. That is expected and does not spend vault funds.'
        : undefined,
  });
}
