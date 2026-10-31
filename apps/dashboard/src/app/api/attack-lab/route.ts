import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { connect, keyStores, KeyPair, type Account as NearAccount } from 'near-api-js';
import { AgentClient, createSanaGuardError, parseErrorCode } from '@sana-guard/sdk';
import {
  ATTACK_EXPECTED,
  ATTACK_KINDS,
  AttackLabSkipError,
  buildAttackMessage,
  expectedRejectionForMessage,
} from '@/lib/attack-lab';
import {
  ATTACK_LAB_TOKEN_HEADER,
  allowAttackLabRequest,
  attackLabClientKey,
  attackLabTokensEqual,
} from '@/lib/attack-lab-guard';
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

function attackLabToken(): string | null {
  const token = process.env.ATTACK_LAB_TOKEN?.trim();
  return token ? token : null;
}

function pinnedVaultId(): number | null {
  const raw = process.env.DEMO_AGENT_VAULT_ID?.trim();
  if (!raw) {
    return null;
  }
  const vaultId = Number(raw);
  if (!Number.isInteger(vaultId) || vaultId < 0) {
    return null;
  }
  return vaultId;
}

function isEnabled(): boolean {
  return demoAgentConfig() !== null && attackLabToken() !== null && pinnedVaultId() !== null;
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
    enabled: isEnabled(),
    vaultId: pinnedVaultId(),
    documented:
      'Attack Lab runs on this Next.js server route so agent keys never enter the browser bundle. Enable it with DEMO_AGENT_ACCOUNT_ID, DEMO_AGENT_PRIVATE_KEY, DEMO_AGENT_VAULT_ID, and ATTACK_LAB_TOKEN. POST requires X-Attack-Lab-Token. The client vault id is ignored; the route pins DEMO_AGENT_VAULT_ID. Every payload is evaluated against a TS port of policy.rs before request_sign.',
  });
}

export async function POST(request: Request) {
  const demo = demoAgentConfig();
  const token = attackLabToken();
  const vaultId = pinnedVaultId();
  if (!demo || !token || vaultId === null) {
    return NextResponse.json(
      {
        enabled: false,
        error:
          'Attack Lab is disabled. Set DEMO_AGENT_ACCOUNT_ID, DEMO_AGENT_PRIVATE_KEY, DEMO_AGENT_VAULT_ID, and ATTACK_LAB_TOKEN on the server. Agent keys are never sent to the browser.',
      },
      { status: 503 }
    );
  }

  if (!allowAttackLabRequest(attackLabClientKey(request))) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  const provided = request.headers.get(ATTACK_LAB_TOKEN_HEADER) ?? '';
  if (!attackLabTokensEqual(provided, token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;
  if (!body || !isAttackKind(body.kind)) {
    return NextResponse.json({ error: 'kind is required' }, { status: 400 });
  }

  const views = createViews();
  const vault = await views.getVault(vaultId);
  if (!vault) {
    return NextResponse.json({ error: 'Pinned demo vault not found' }, { status: 404 });
  }

  const recipients = await views.getRecipients(vaultId);
  const connection = new Connection(publicConfig.solanaRpcUrl, 'confirmed');
  const latest = await connection.getLatestBlockhash('confirmed');
  let message: Uint8Array;
  try {
    message = buildAttackMessage({
      kind: body.kind,
      vaultAddress: vault.vaultAddress,
      recentBlockhash: latest.blockhash,
      policy: vault.policy,
      allowlistedRecipient: recipients[0],
    });
  } catch (error) {
    if (error instanceof AttackLabSkipError) {
      return NextResponse.json({ error: error.message, kind: body.kind, vaultId }, { status: 409 });
    }
    throw error;
  }

  const localCode = expectedRejectionForMessage(body.kind, message, {
    vaultAddress: vault.vaultAddress,
    policy: vault.policy,
    recipients,
  });
  if (localCode !== ATTACK_EXPECTED[body.kind]) {
    return NextResponse.json(
      {
        error: `Attack payload did not evaluate to ${ATTACK_EXPECTED[body.kind]} (got ${localCode}). request_sign was not called.`,
        kind: body.kind,
        expected: ATTACK_EXPECTED[body.kind],
        evaluated: localCode,
      },
      { status: 409 }
    );
  }

  const account = await connectAgent(demo);
  const client = new AgentClient(
    connection,
    account,
    publicConfig.guardContract,
    new PublicKey(vault.vaultAddress)
  );

  let attempt: Record<string, unknown>;
  try {
    await client.requestSign({
      vaultId,
      message,
    });
    attempt = { unexpected: 'request_sign succeeded; the guard should have rejected this' };
  } catch (error) {
    attempt = errorPayload(error);
  }

  return NextResponse.json({
    enabled: true,
    kind: body.kind,
    expected: ATTACK_EXPECTED[body.kind],
    evaluated: localCode,
    vaultId,
    attempts: [{ pass: 1, result: attempt }],
  });
}
