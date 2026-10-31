/**
 * Base error for Sana Guard SDK
 */
export class SanaGuardError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'SanaGuardError';
  }
}

/**
 * Thrown when request_sign fails after a request id was allocated.
 * Callers can poll get_request or submit Release with `requestId`.
 */
export class SanaGuardSignError extends SanaGuardError {
  constructor(
    message: string,
    public readonly requestId: string,
    code?: string,
    public readonly nearTxHash?: string
  ) {
    super(message, code);
    this.name = 'SanaGuardSignError';
  }
}

/**
 * Wrap any request_sign failure so the allocated request id is never dropped.
 */
export function toSignError(
  error: unknown,
  requestId: string,
  nearTxHash?: string
): SanaGuardSignError {
  if (error instanceof SanaGuardSignError) {
    return error;
  }
  if (error instanceof SanaGuardError) {
    return new SanaGuardSignError(error.message, requestId, error.code, nearTxHash);
  }
  const message =
    error instanceof Error ? error.message : error != null ? String(error) : 'Unknown error';
  const mapped = createSanaGuardError(message);
  return new SanaGuardSignError(mapped.message, requestId, mapped.code, nearTxHash);
}

/**
 * Sana Guard contract error codes mapped from the contract
 */
const ERROR_MESSAGES: Record<string, string> = {
  // Message parsing errors (001-050)
  SG_E001_SIZE: 'Message size out of bounds (32-1167 bytes)',
  SG_E002_UNSUPPORTED_VERSION: 'Unsupported message version (only legacy and v0 allowed)',
  SG_E003_TRUNCATED_HEADER: 'Message header is truncated',
  SG_E004_MULTI_SIG: 'Multi-signature messages not allowed',
  SG_E005_READONLY_SIGNER: 'Readonly signer not allowed',
  SG_E006_KEY_COUNT: 'Invalid key count (must be 1-64)',
  SG_E007_READONLY_COUNT: 'Invalid readonly unsigned count',
  SG_E008_TRUNCATED_KEYS: 'Key list is truncated',
  SG_E009_TRUNCATED_BLOCKHASH: 'Blockhash is truncated',
  SG_E010_IX_COUNT: 'Invalid instruction count (must be 1-8)',
  SG_E011_TRUNCATED_IX: 'Instruction is truncated',
  SG_E012_INVALID_PROGRAM_INDEX: 'Invalid program ID index',
  SG_E013_TRUNCATED_ACCOUNTS: 'Account indices truncated',
  SG_E014_INVALID_ACCOUNT_INDEX: 'Invalid account index',
  SG_E015_TRUNCATED_DATA: 'Instruction data truncated',
  SG_E016_ALT_NOT_ALLOWED: 'Address lookup tables not allowed',
  SG_E017_TRAILING_BYTES: 'Unexpected trailing bytes in message',
  SG_E018_UNKNOWN_PROGRAM: 'Program not in supported list',
  SG_E019_SYSTEM_DATA_TOO_SHORT: 'System instruction data too short',
  SG_E020_SYSTEM_TRANSFER_LENGTH: 'System transfer data wrong length',
  SG_E021_SYSTEM_TRANSFER_ACCOUNTS: 'System transfer wrong account count',
  SG_E022_SYSTEM_UNSUPPORTED: 'Unsupported System instruction',
  SG_E023_TOKEN_DATA_EMPTY: 'Token instruction data empty',
  SG_E024_TOKEN_TRANSFER_LENGTH: 'Token transfer data wrong length',
  SG_E025_TOKEN_TRANSFER_ACCOUNTS: 'Token transfer wrong account count',
  SG_E026_TOKEN_TRANSFER_CHECKED_LENGTH: 'Token transferChecked data wrong length',
  SG_E027_TOKEN_TRANSFER_CHECKED_ACCOUNTS: 'Token transferChecked wrong account count',
  SG_E028_TOKEN_UNSUPPORTED: 'Unsupported Token instruction',
  SG_E029_ATA_UNSUPPORTED: 'Unsupported ATA instruction (only create-idempotent allowed)',
  SG_E030_ATA_ACCOUNTS: 'ATA create wrong account count',
  SG_E031_CB_DATA_EMPTY: 'ComputeBudget instruction data empty',
  SG_E032_CB_LIMIT_LENGTH: 'ComputeBudget setLimit data wrong length',
  SG_E033_CB_PRICE_LENGTH: 'ComputeBudget setPrice data wrong length',
  SG_E034_CB_UNSUPPORTED: 'Unsupported ComputeBudget instruction',
  SG_E035_MEMO_INVALID_UTF8: 'Memo text is not valid UTF-8',
  SG_E036_COMPACT_EMPTY: 'Compact-u16 buffer empty',
  SG_E037_COMPACT_TRUNCATED: 'Compact-u16 truncated',
  SG_E038_COMPACT_TRUNCATED: 'Compact-u16 truncated (3-byte)',
  SG_E039_KEY_INDEX_OUT_OF_BOUNDS: 'Key index out of bounds',
  SG_E040_WRONG_FROM: 'System transfer from address is not vault address',
  SG_E041_OVERFLOW: 'Spend calculation overflow',
  SG_E042_WRONG_AUTHORITY: 'Token transfer authority is not vault address',
  SG_E043_MINT_UNKNOWN: 'Token transfer mint unknown (must use transferChecked)',
  SG_E044_OVERFLOW: 'Spend calculation overflow',
  SG_E045_WRONG_PAYER: 'ATA create payer is not vault address',
  SG_E046_OVERFLOW: 'Spend calculation overflow',
  SG_E047_DUPLICATE_CB_LIMIT: 'Duplicate ComputeBudget setLimit instruction',
  SG_E048_DUPLICATE_CB_PRICE: 'Duplicate ComputeBudget setPrice instruction',
  SG_E049_OVERFLOW: 'Priority fee calculation overflow',
  SG_E050_OVERFLOW: 'Priority fee addition overflow',

  // Request validation errors (051-077)
  SG_E051_GLOBAL_PAUSED: 'Contract is globally paused',
  SG_E052_AGENT_NOT_REGISTERED: 'Agent account not registered with any vault',
  SG_E053_VAULT_MISMATCH: 'Agent is not registered to this vault',
  SG_E054_VAULT_NOT_FOUND: 'Vault not found',
  SG_E055_VAULT_PAUSED: 'Vault is paused',
  SG_E056_AGENT_NOT_IN_VAULT: 'Agent not in vault agents list',
  SG_E057_POLICY_EXPIRED: 'Vault policy has expired',
  SG_E058_INVALID_REQ_ID: 'Request ID must be 32 bytes hex',
  SG_E059_DUPLICATE_REQ_ID: 'Request ID already used',
  SG_E060_DUPLICATE_MSG_HASH: 'Message hash already signed in last 24h',
  SG_E061_WRONG_FEE_PAYER: 'Message fee payer is not vault address',
  SG_E062_PER_TX_LIMIT_EXCEEDED: 'Per-transaction limit exceeded for mint',
  SG_E063_MINT_NOT_IN_PER_TX_LIMIT: 'Mint not in policy per-tx limit',
  SG_E064_DAILY_CAP_EXCEEDED: '24-hour spend cap exceeded for mint',
  SG_E065_MINT_NOT_IN_DAILY_CAP: 'Mint not in policy daily cap',
  SG_E066_INSUFFICIENT_GAS: 'Insufficient gas to complete MPC sign',
  SG_E067_RECIPIENT_NOT_ALLOWED: 'System transfer recipient not in allowlist',
  SG_E068_RECIPIENT_NOT_ALLOWED: 'Token transfer recipient not in allowlist',
  SG_E069_MINT_NOT_IN_POLICY: 'SPL mint not in policy limits',
  SG_E070_ATA_NOT_ALLOWED: 'ATA address not in recipient allowlist',
  SG_E071_MINT_NOT_IN_POLICY: 'ATA mint not in policy limits',
  SG_E072_PRIORITY_FEE_TOO_HIGH: 'ComputeBudget price exceeds max priority fee',
  SG_E073_MEMO_TOO_LONG: 'Memo text exceeds max length',
  SG_E074_PROGRAM_NOT_ALLOWED: 'Program not in policy allowlist',
  SG_E075_INVALID_POLICY_PROGRAM: 'Policy program not in supported list or invalid format',
  SG_E076_VAULT_NOT_ACTIVE: 'Vault is not in Active state',
  SG_E077_AGENT_EXISTS: 'Agent account name is already registered',
};

/**
 * Parse error code from contract panic message
 */
export function parseErrorCode(message: string): string | null {
  const match = message.match(/SG_E\d{3}_[A-Z0-9_]+/);
  return match ? match[0] : null;
}

/**
 * Create a typed error from a contract error message
 */
export function createSanaGuardError(message: string): SanaGuardError {
  const code = parseErrorCode(message);
  if (code && ERROR_MESSAGES[code]) {
    return new SanaGuardError(ERROR_MESSAGES[code], code);
  }
  return new SanaGuardError(message);
}

/**
 * Get human-readable message for an error code
 */
export function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || `Unknown error: ${code}`;
}

/**
 * Check if an error is a specific Sana Guard error code
 */
export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof SanaGuardError && error.code === code;
}

/**
 * Every SG_E### code this SDK maps. Used by the contract-drift test.
 */
export function knownErrorCodes(): string[] {
  return Object.keys(ERROR_MESSAGES);
}
