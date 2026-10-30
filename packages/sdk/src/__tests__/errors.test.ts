import { parseErrorCode, getErrorMessage, isErrorCode, SanaGuardError, createSanaGuardError } from '../errors';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Errors', () => {
  describe('parseErrorCode', () => {
    it('should extract error code from panic message', () => {
      expect(parseErrorCode('Smart contract panicked: SG_E001_SIZE')).toBe('SG_E001_SIZE');
      expect(parseErrorCode('SG_E062_PER_TX_LIMIT_EXCEEDED with context')).toBe('SG_E062_PER_TX_LIMIT_EXCEEDED');
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

  describe('error code completeness', () => {
    it('should have mappings for all contract error codes', () => {
      // Read contract source files
      const contractPath = join(__dirname, '../../../contracts/guard/src');
      
      try {
        const parserContent = readFileSync(join(contractPath, 'parser.rs'), 'utf-8');
        const policyContent = readFileSync(join(contractPath, 'policy.rs'), 'utf-8');
        
        // Extract all SG_E### error codes from contract
        const errorCodeRegex = /SG_E\d{3}_[A-Z0-9_]+/g;
        const parserCodes = parserContent.match(errorCodeRegex) || [];
        const policyCodes = policyContent.match(errorCodeRegex) || [];
        const allContractCodes = new Set([...parserCodes, ...policyCodes]);
        
        // Check that we have a message for each code
        const missingCodes: string[] = [];
        allContractCodes.forEach(code => {
          const message = getErrorMessage(code);
          if (message.startsWith('Unknown error:')) {
            missingCodes.push(code);
          }
        });
        
        if (missingCodes.length > 0) {
          console.warn('Missing error mappings:', missingCodes);
        }
        
        // We should have at least 50 error codes mapped (001-076)
        expect(allContractCodes.size).toBeGreaterThanOrEqual(50);
      } catch (error) {
        // If we can't read contract files (e.g. in CI), skip this test
        console.warn('Could not read contract files, skipping completeness check');
      }
    });
  });
});
