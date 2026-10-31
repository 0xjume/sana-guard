// Types
export type {
  Mint,
  Policy,
  VaultState,
  VaultView,
  SignRequestStatus,
  SignRequestView,
  OwnerAction,
  Ed25519Signer,
  SignedAdminMessage,
  MpcSignResult,
  TransferParams,
  MessageVersion,
  RequestSignParams,
  SignResult,
  BroadcastResult,
  SolanaCluster,
} from './types';

// Errors
export {
  SanaGuardError,
  SanaGuardSignError,
  toSignError,
  parseErrorCode,
  createSanaGuardError,
  getErrorMessage,
  isErrorCode,
  knownErrorCodes,
} from './errors';

// Message building
export {
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  ATA_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAM,
  U64_MAX,
  encodeU64Le,
  encodeCompactU16,
  encodeComputeUnitPriceData,
  setComputeUnitPriceInstruction,
  buildSolTransfer,
  buildTokenTransfer,
  buildMessageWithMemo,
  assertNotV1Message,
  verifyMessageSignature,
  assembleSignedTransaction,
  extractRecentBlockhash,
} from './messages';

// Admin
export {
  VAULT_STORAGE_COST,
  AGENT_STORAGE_OVERHEAD,
  MIN_AGENT_FUNDING,
  MAX_AGENT_FUNDING,
  signAdminMessage,
  vaultHeaderFromAction,
  calculateRequiredDeposit,
  createVaultAction,
  setPolicyAction,
  addRecipientAction,
  addTokenAccountRecipientAction,
  addAgentAction,
  removeAgentAction,
  removeRecipientAction,
  registerTokenAccountAction,
  pauseAction,
  unpauseAction,
  releaseAction,
  backfillRecipientsAction,
} from './admin';

export type { CreateVaultParams, AddAgentParams } from './admin';

// Agent client
export {
  AgentClient,
  validateIdempotencyKey,
  inferSolanaCluster,
  solanaExplorerUrl,
  extractNearTxHash,
} from './client';

// Views
export { Views, parseSpend24hJson, parseU64Amount, parseJsonIntegersAsStrings } from './views';
