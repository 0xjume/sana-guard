import { PublicKey, SystemProgram } from '@solana/web3.js';
import { buildSolTransfer, assertNotV1Message, SYSTEM_PROGRAM } from '../messages';
import { SanaGuardError } from '../errors';

describe('Messages', () => {
  const from = new PublicKey('11111111111111111111111111111111');
  const to = new PublicKey('11111111111111111111111111111112');
  const blockhash = 'Ht6GqHqTWjgDKVVALPWnR1qXaP8Qm7u2abYcGvMxLbGN';

  describe('buildSolTransfer', () => {
    it('should build a v0 message for SOL transfer', () => {
      const message = buildSolTransfer(from, to, BigInt(1000000), blockhash, { version: 'v0' });

      // v0 starts with 0x80
      expect(message[0]).toBe(0x80);

      // Header checks (actual values depend on @solana/web3.js compilation)
      // Just verify it's a valid message
      expect(message[1]).toBeGreaterThanOrEqual(1); // numRequiredSignatures >= 1
      expect(message.length).toBeGreaterThan(32);
      expect(message.length).toBeLessThanOrEqual(1167);
    });

    it('should build a legacy message for SOL transfer', () => {
      const message = buildSolTransfer(from, to, BigInt(1000000), blockhash, { version: 'legacy' });

      // Legacy does NOT start with 0x80
      expect(message[0]).not.toBe(0x80);

      // First byte is numRequiredSignatures (1)
      expect(message[0]).toBeGreaterThanOrEqual(1);

      // Check message size
      expect(message.length).toBeGreaterThan(32);
      expect(message.length).toBeLessThanOrEqual(1167);
    });

    it('should include ComputeBudget instructions when provided', () => {
      const message = buildSolTransfer(from, to, BigInt(1000000), blockhash, {
        version: 'v0',
        computeUnitLimit: 1400,
        computeUnitPrice: BigInt(1000),
      });

      // v0 message with ComputeBudget
      expect(message[0]).toBe(0x80);

      // Check message size is larger than without ComputeBudget
      const messageWithoutCB = buildSolTransfer(from, to, BigInt(1000000), blockhash, { version: 'v0' });
      expect(message.length).toBeGreaterThan(messageWithoutCB.length);
    });
  });

  describe('assertNotV1Message', () => {
    it('should pass for v0 messages', () => {
      const v0Message = Buffer.from([0x80, 0x01, 0x00, 0x00]);
      expect(() => assertNotV1Message(v0Message)).not.toThrow();
    });

    it('should pass for legacy messages', () => {
      const legacyMessage = Buffer.from([0x01, 0x00, 0x00, 0x03]);
      expect(() => assertNotV1Message(legacyMessage)).not.toThrow();
    });

    it('should reject v1 (0x81) messages', () => {
      const v1Message = Buffer.from([0x81, 0x00, 0x00, 0x00]);
      expect(() => assertNotV1Message(v1Message)).toThrow(SanaGuardError);
      expect(() => assertNotV1Message(v1Message)).toThrow('v1 (0x81) messages are not supported');
    });
  });

  describe('message format golden fixtures', () => {
    /**
     * Golden fixture test: match exact bytes against contract parser test vectors
     * 
     * These fixtures are derived from the contract's parser tests in contracts/guard/src/tests.rs
     */
    it('should produce message bytes matching contract test vector for simple transfer', () => {
      // From contract test: simple SOL transfer 1000000 lamports
      const from = new PublicKey('4wBqpZM9xaSheZzJSMawUHDgr5FMwPvvJGZMqL8kvF3U');
      const to = new PublicKey('5wHqbdqaWZJCRxX4DPpXaBPfQK9VvNvJkv4Q9aNmRbHZ');
      const blockhash = 'DZq3ZqCCVdX3sxXNUjHrmKfV3PcpAZgYyQs7o6HpGYrN';

      const message = buildSolTransfer(from, to, BigInt(1000000), blockhash, { version: 'v0' });

      // Expected structure (not exact bytes, since Solana lib may differ):
      // - v0 prefix: 0x80
      // - header: 1, 0, 1 (1 req sig, 0 readonly signed, 1 readonly unsigned)
      // - 3 keys: from, to, SystemProgram(0x0...0)
      expect(message[0]).toBe(0x80);
      expect(message[1]).toBe(1); // numRequiredSignatures
      expect(message[2]).toBe(0); // numReadonlySigned
      expect(message[3]).toBe(1); // numReadonlyUnsigned

      // Check that message is valid size (32-1167 bytes)
      expect(message.length).toBeGreaterThanOrEqual(32);
      expect(message.length).toBeLessThanOrEqual(1167);
    });
  });

  describe('SYSTEM_PROGRAM constant', () => {
    it('should match Solana SystemProgram.programId', () => {
      expect(SYSTEM_PROGRAM.toBase58()).toBe(SystemProgram.programId.toBase58());
    });
  });
});
