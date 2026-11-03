import bs58 from 'bs58';
import {
  formatDurationNs,
  formatSol,
  formatTimestampNs,
  programLabel,
  shortenAddress,
  worstCasePriorityFeeLamports,
  yoctoToNear,
} from './format';

/**
 * Decode the exact bytes that will be passed to the wallet signer.
 * Invalid UTF-8 is rejected (fatal) so the review dialog never shows a lossy stand-in.
 */
export function decodeAdminSignBytes(message: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(message);
}

/**
 * Human-readable view of an owner admin message, decoded from the exact text that is about to
 * be signed (SANA-GUARD-ADMIN-v1, 7 lines). Nothing here comes from UI state, so what the owner
 * reviews is what they sign.
 */
export type ReviewTone = 'default' | 'warning' | 'destructive';

export interface AdminMessageRow {
  label: string;
  value: string;
  /** Present only when the signed message itself implies the prior state. */
  previous?: string;
}

export interface AdminMessageReview {
  actionType: string;
  title: string;
  tone: ReviewTone;
  network: string;
  contract: string;
  vault: string;
  nonce: string;
  expires: string;
  rows: AdminMessageRow[];
  warnings: string[];
}

function actionTitle(actionType: string, vaultId: string): string {
  const n = vaultId === 'null' ? null : vaultId;
  switch (actionType) {
    case 'CreateVault':
      return 'Create vault';
    case 'SetPolicy':
      return n === null ? 'Change vault policy' : `Change vault #${n} policy`;
    case 'AddRecipient':
      return n === null ? 'Allowlist a recipient' : `Allowlist a recipient on vault #${n}`;
    case 'RemoveRecipient':
      return n === null ? 'Remove a recipient' : `Remove a recipient from vault #${n}`;
    case 'RegisterTokenAccount':
      return n === null
        ? 'Register a vault token account'
        : `Register a token account on vault #${n}`;
    case 'AddAgent':
      return n === null ? 'Add an agent' : `Add an agent to vault #${n}`;
    case 'RemoveAgent':
      return n === null ? 'Remove an agent' : `Remove agent from vault #${n}`;
    case 'Pause':
      return n === null ? 'Pause vault' : `Pause vault #${n}`;
    case 'Unpause':
      return n === null ? 'Unpause vault' : `Unpause vault #${n}`;
    case 'Release':
      return n === null ? 'Release a reserved spend' : `Release a reserved spend on vault #${n}`;
    case 'BackfillRecipients':
      return n === null ? 'Backfill recipient index' : `Backfill recipient index on vault #${n}`;
    default:
      return actionType;
  }
}

function reviewTone(actionType: string): ReviewTone {
  switch (actionType) {
    case 'Pause':
    case 'RemoveAgent':
    case 'RemoveRecipient':
      return 'destructive';
    case 'Unpause':
    case 'SetPolicy':
      return 'warning';
    default:
      return 'default';
  }
}

type RawMint = 'Sol' | { Spl: number[] };

function mintLabel(mint: RawMint): string {
  return mint === 'Sol' ? 'SOL' : shortenAddress(bs58.encode(Uint8Array.from(mint.Spl)), 6, 4);
}

function amountLabel(mint: RawMint, amount: string): string {
  return mint === 'Sol' ? formatSol(BigInt(amount)) : `${amount} base units`;
}

function policyRows(policy: Record<string, unknown>): {
  rows: AdminMessageReview['rows'];
  warnings: string[];
} {
  const rows: AdminMessageReview['rows'] = [];
  const warnings: string[] = [];
  const perTx = (policy.per_tx_limit as Array<[RawMint, string]>) ?? [];
  const daily = (policy.daily_cap as Array<[RawMint, string]>) ?? [];
  for (const [mint, amount] of perTx) {
    rows.push({ label: `Per-tx limit (${mintLabel(mint)})`, value: amountLabel(mint, amount) });
  }
  for (const [mint, amount] of daily) {
    rows.push({ label: `24h cap (${mintLabel(mint)})`, value: amountLabel(mint, amount) });
  }
  const programs = (policy.programs as string[]) ?? [];
  rows.push({
    label: 'Allowed programs',
    value: programs.length ? programs.map(programLabel).join(', ') : 'None (nothing can be signed)',
  });
  const perCu = BigInt((policy.max_priority_fee_lamports as string) ?? '0');
  const totalRaw = policy.max_total_priority_fee_lamports as string | undefined | null;
  const total = totalRaw === undefined || totalRaw === null ? undefined : BigInt(totalRaw);
  rows.push({ label: 'Max compute-unit price', value: `${perCu} lamports / CU` });
  rows.push({
    label: 'Max total priority fee / tx',
    value: total === undefined ? 'No cap' : formatSol(total),
  });
  if (perCu > 0n && total === undefined) {
    warnings.push(
      `No total priority fee cap: one transaction may pay up to ${formatSol(
        worstCasePriorityFeeLamports(perCu)
      )} in priority fees.`
    );
  }
  rows.push({ label: 'Max memo length', value: String(policy.max_memo_len ?? '—') });
  rows.push({
    label: 'Policy expires',
    value: formatTimestampNs(BigInt((policy.expires_at_ns as string) ?? '0')),
  });
  rows.push({
    label: 'Loosen delay',
    value: formatDurationNs(BigInt((policy.loosen_delay_ns as string) ?? '0')),
  });
  return { rows, warnings };
}

function value(line: string | undefined, prefix: string): string {
  if (!line || !line.startsWith(prefix)) {
    throw new Error(`Admin message is missing "${prefix.trim()}"`);
  }
  return line.slice(prefix.length);
}

export function describeAdminMessage(text: string): AdminMessageReview {
  const lines = text.split('\n');
  if (lines.length !== 7 || lines[0] !== 'SANA-GUARD-ADMIN-v1') {
    throw new Error('Not a SANA-GUARD-ADMIN-v1 message');
  }
  const network = value(lines[1], 'network: ');
  const contract = value(lines[2], 'contract: ');
  const vault = value(lines[3], 'vault: ');
  const nonce = value(lines[4], 'nonce: ');
  const expiresNs = value(lines[5], 'expires: ');
  const action = JSON.parse(value(lines[6], 'action: ')) as Record<string, unknown>;
  const actionType = String(action.type);

  let rows: AdminMessageReview['rows'] = [];
  let warnings: string[] = [];
  switch (actionType) {
    case 'CreateVault': {
      rows.push({ label: 'Owner', value: String(action.owner) });
      rows.push({ label: 'Vault address', value: String(action.vault_address) });
      const policy = policyRows(action.policy as Record<string, unknown>);
      rows = [...rows, ...policy.rows];
      warnings = policy.warnings;
      break;
    }
    case 'SetPolicy': {
      const policy = policyRows(action.policy as Record<string, unknown>);
      rows = policy.rows;
      warnings = policy.warnings;
      break;
    }
    case 'AddRecipient':
      rows.push({ label: 'Recipient', value: String(action.recipient) });
      break;
    case 'RemoveRecipient':
      rows.push({
        label: 'Recipient',
        previous: String(action.recipient),
        value: 'Removed',
      });
      break;
    case 'RegisterTokenAccount':
      rows.push({ label: 'Token account', value: String(action.ata) });
      rows.push({ label: 'Mint', value: String(action.mint) });
      rows.push({ label: 'Decimals', value: String(action.decimals) });
      break;
    case 'AddAgent':
      rows.push({ label: 'Agent account', value: `${String(action.name)}.${contract}` });
      rows.push({ label: 'Function-call key', value: String(action.public_key) });
      rows.push({
        label: 'Gas funding',
        value: `${yoctoToNear(BigInt(String(action.gas_funding)))} NEAR`,
      });
      break;
    case 'RemoveAgent':
      rows.push({
        label: 'Agent account',
        previous: String(action.agent),
        value: 'Removed',
      });
      break;
    case 'Pause':
      rows.push({ label: 'Vault state', previous: 'Active', value: 'Paused' });
      break;
    case 'Unpause':
      rows.push({ label: 'Vault state', previous: 'Paused', value: 'Active' });
      break;
    case 'Release':
      rows.push({ label: 'Request id', value: String(action.req_id) });
      break;
    default:
      break;
  }

  return {
    actionType,
    title: actionTitle(actionType, vault),
    tone: reviewTone(actionType),
    network,
    contract,
    vault: vault === 'null' ? 'new vault' : `#${vault}`,
    nonce,
    expires: formatTimestampNs(BigInt(expiresNs)),
    rows,
    warnings,
  };
}
