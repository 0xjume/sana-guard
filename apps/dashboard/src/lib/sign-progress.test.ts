import { describe, expect, it } from 'vitest';
import {
  bindOwnerSignProgress,
  createVaultButtonLabel,
  reportOwnerSignProgress,
  signDialogButtonLabel,
  vaultCreatedMessage,
} from './sign-progress';

describe('sign progress labels', () => {
  it('replaces a frozen Signing label with the stage the owner is in', () => {
    expect(signDialogButtonLabel(null)).toBe('Sign with wallet');
    expect(signDialogButtonLabel({ phase: 'submitting' })).toBe('Submitting…');
    expect(signDialogButtonLabel({ phase: 'confirming', txHash: 'abc' })).toBe(
      'Confirming on NEAR…'
    );
    expect(createVaultButtonLabel(null, false)).toBe('Create vault');
    expect(createVaultButtonLabel(null, true)).toBe('Preparing…');
    expect(createVaultButtonLabel({ phase: 'submitting' }, true)).toBe('Submitting…');
    expect(createVaultButtonLabel({ phase: 'confirming', txHash: 'abc' }, true)).toBe(
      'Confirming on NEAR…'
    );
  });

  it('names the vault id once the callback log is known', () => {
    expect(vaultCreatedMessage(undefined)).toBe('Vault created.');
    expect(vaultCreatedMessage(1)).toBe('Vault 1 created.');
  });

  it('delivers progress to the current listener only', () => {
    const seen: Array<string | null> = [];
    const unbind = bindOwnerSignProgress((progress) => {
      seen.push(progress?.phase ?? null);
    });
    reportOwnerSignProgress({ phase: 'submitting' });
    reportOwnerSignProgress({ phase: 'confirming', txHash: 'abc' });
    reportOwnerSignProgress(null);
    unbind();
    reportOwnerSignProgress({ phase: 'submitting' });
    expect(seen).toEqual(['submitting', 'confirming', null]);
  });
});
