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
  BroadcastResult,
} from './types';

// Errors
export {
  SanaGuardError,
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
  calculateRequiredDeposit,
  createVaultAction,
  setPolicyAction,
  addRecipientAction,
  addAgentAction,
  pauseAction,
  unpauseAction,
  releaseAction,
  backfillRecipientsAction,
} from './admin';

export type { CreateVaultParams, AddAgentParams } from './admin';

// Agent client
export { AgentClient } from './client';

// Views
export { Views } from './views';
