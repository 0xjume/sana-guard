import { parseErrorCode, getErrorMessage, isErrorCode, SanaGuardError, createSanaGuardError } from '../errors';

describe('Errors', () => {
  describe('parseErrorCode', () => {
    it('should extract error code from panic message', () => {
      expect(parseErrorCode('Smart contract panicked: SG_E001_SIZE')).toBe('SG_E001_SIZE');
      expect(parseErrorCode('SG_E062_PER_TX_LIMIT_EXCEEDED with context')).toBe('SG_E062_PER_TX_LIMIT_EXCEEDED');
      expect(parseErrorCode('No error code here')).toBeNull();
    });
  });

  describe('getErrorMessage', () => {
    it('should return human-readable message for known codes', () => {
      expect(getErrorMessage('SG_E001_SIZE')).toBe('Message size out of bounds (32-1167 bytes)');
      expect(getErrorMessage('SG_E051_GLOBAL_PAUSED')).toBe('Contract is globally paused');
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
});
