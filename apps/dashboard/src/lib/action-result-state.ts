import type { GuardActionError } from './errors';

export type ActionResultView =
  | { kind: 'idle' }
  | { kind: 'error'; error: GuardActionError }
  | { kind: 'success'; message: string; txHash: string };

export function submittedSuccess(
  txHash: string | null | undefined,
  message: string
): string | null {
  if (!txHash) {
    return null;
  }
  return message;
}

export function actionResultDisplay(args: {
  error?: GuardActionError | null;
  txHash?: string | null;
  success?: string | null;
}): ActionResultView {
  if (args.error) {
    return { kind: 'error', error: args.error };
  }
  if (args.txHash) {
    return {
      kind: 'success',
      message: args.success ?? 'Submitted',
      txHash: args.txHash,
    };
  }
  return { kind: 'idle' };
}
