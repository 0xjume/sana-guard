/**
 * Opt-in live read against guard.djume.testnet + Solana devnet.
 * Never run in CI. Requires agent credentials in the environment.
 *
 *   SANA_GUARD_LIVE=1 pnpm --filter @sana-guard/mcp test:live
 */
import { createRuntime } from '../src/runtime.ts';
import { createToolHandlers } from '../src/tools.ts';

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content[0];
  if (!item || item.type !== 'text' || !item.text) {
    throw new Error('expected text content');
  }
  return item.text;
}

async function main(): Promise<void> {
  if (process.env.SANA_GUARD_LIVE !== '1') {
    console.error('Set SANA_GUARD_LIVE=1 to run the live script.');
    process.exit(0);
  }

  const runtime = await createRuntime();
  const tools = createToolHandlers(runtime);

  const status = JSON.parse(textOf(await tools.status())) as {
    ok?: boolean;
    vaultAddress?: string;
  };
  const policy = JSON.parse(textOf(await tools.getPolicy())) as {
    ok?: boolean;
    recipients?: string[];
  };
  console.log('status.ok', status.ok, 'vault', status.vaultAddress);
  console.log('policy.ok', policy.ok, 'recipients', policy.recipients?.length ?? 0);

  const recipient = policy.recipients?.[0];
  if (recipient) {
    const check = JSON.parse(
      textOf(await tools.checkTransfer({ kind: 'sol', to: recipient, amount: '1' }))
    ) as { wouldPass?: boolean; reasons?: unknown };
    console.log('check_transfer', check.wouldPass, check.reasons ?? []);
  }

  console.log('live read finished (no request_sign)');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
