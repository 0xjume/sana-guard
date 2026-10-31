import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  parseErrorCode,
  getErrorMessage,
  isErrorCode,
  SanaGuardError,
  SanaGuardSignError,
  createSanaGuardError,
  toSignError,
  knownErrorCodes,
} from '../errors';

function findRepoRoot(startDir: string): string {
  const { existsSync } = require('fs') as typeof import('fs');
  const { resolve } = require('path') as typeof import('path');
  let dir = startDir;
  for (;;) {
    if (
      existsSync(join(dir, 'contracts/guard/src')) &&
      existsSync(join(dir, 'pnpm-workspace.yaml'))
    ) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(`Could not find repo root from ${startDir}`);
    }
    dir = parent;
  }
}

describe('Errors', () => {
  describe('parseErrorCode', () => {
    it('should extract error code from panic message', () => {
      expect(parseErrorCode('Smart contract panicked: SG_E001_SIZE')).toBe('SG_E001_SIZE');
      expect(parseErrorCode('SG_E062_PER_TX_LIMIT_EXCEEDED with context')).toBe(
        'SG_E062_PER_TX_LIMIT_EXCEEDED'
      );
      expect(parseErrorCode('No error code here')).toBeNull();
    });

    it('should extract error codes with numbers', () => {
      expect(parseErrorCode('SG_E035_MEMO_INVALID_UTF8')).toBe('SG_E035_MEMO_INVALID_UTF8');
    });
  });

  describe('getErrorMessage', () => {
    it('should return human-readable message for known codes', () => {
      expect(getErrorMessage('SG_E001_SIZE')).toBe('Message size out of bounds (32-1167 bytes)');
      expect(getErrorMessage('SG_E051_GLOBAL_PAUSED')).toBe('Contract is globally paused');
      expect(getErrorMessage('SG_E035_MEMO_INVALID_UTF8')).toBe('Memo text is not valid UTF-8');
      expect(getErrorMessage('SG_E076_VAULT_NOT_ACTIVE')).toBe('Vault is not in Active state');
      expect(getErrorMessage('SG_E999_UNKNOWN')).toContain('Unknown error');
    });
  });

  describe('createSanaGuardError', () => {
    it('should create error with extracted code', () => {
      const error = createSanaGuardError('Smart contract panicked: SG_E055_VAULT_PAUSED');
      expect(error.code).toBe('SG_E055_VAULT_PAUSED');
      expect(error.message).toBe('Vault is paused');
    });

    it('should handle messages without codes', () => {
      const error = createSanaGuardError('Unknown failure');
      expect(error.code).toBeUndefined();
      expect(error.message).toBe('Unknown failure');
    });
  });

  describe('isErrorCode', () => {
    it('should check error code', () => {
      const error = new SanaGuardError('Test', 'SG_E001_SIZE');
      expect(isErrorCode(error, 'SG_E001_SIZE')).toBe(true);
      expect(isErrorCode(error, 'SG_E002_UNSUPPORTED_VERSION')).toBe(false);
      expect(isErrorCode(new Error('Other'), 'SG_E001_SIZE')).toBe(false);
    });
  });

  describe('SanaGuardSignError', () => {
    it('carries requestId and remains an isErrorCode match', () => {
      const error = new SanaGuardSignError('Vault is paused', 'ab'.repeat(32), 'SG_E055_VAULT_PAUSED');
      expect(error).toBeInstanceOf(SanaGuardError);
      expect(error.requestId).toBe('ab'.repeat(32));
      expect(isErrorCode(error, 'SG_E055_VAULT_PAUSED')).toBe(true);
    });

    it('toSignError wraps contract panics without dropping requestId', () => {
      const wrapped = toSignError(
        new Error('Smart contract panicked: SG_E058_INVALID_REQ_ID'),
        'cd'.repeat(32)
      );
      expect(wrapped).toBeInstanceOf(SanaGuardSignError);
      expect(wrapped.requestId).toBe('cd'.repeat(32));
      expect(wrapped.code).toBe('SG_E058_INVALID_REQ_ID');
    });
  });

  describe('error code completeness', () => {
    it('should have mappings for every SG_E### in contracts/guard/src', () => {
      const contractSrc = join(findRepoRoot(__dirname), 'contracts/guard/src');
      const rustFiles = readdirSync(contractSrc).filter((name) => name.endsWith('.rs'));
      expect(rustFiles.length).toBeGreaterThan(0);

      const errorCodeRegex = /SG_E\d{3}_[A-Z0-9_]+/g;
      const contractCodes = new Set<string>();
      for (const file of rustFiles) {
        const content = readFileSync(join(contractSrc, file), 'utf-8');
        const matches = content.match(errorCodeRegex) || [];
        for (const code of matches) {
          contractCodes.add(code);
        }
      }

      expect(contractCodes.size).toBeGreaterThan(0);
      expect(contractCodes.has('SG_E076_VAULT_NOT_ACTIVE')).toBe(true);

      const mapped = new Set(knownErrorCodes());
      const missing = [...contractCodes].filter((code) => !mapped.has(code)).sort();
      expect(missing).toEqual([]);
    });
  });
});
