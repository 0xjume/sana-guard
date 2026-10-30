import { describe, it, expect } from "vitest";
import { parseAdminMessage, verifySignature } from "./validation.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

describe("parseAdminMessage", () => {
  it("parses valid CreateVault message", () => {
    const msg = [
      "SANA-GUARD-ADMIN-v1",
      "network: near-testnet",
      "contract: guard.djume.testnet",
      "vault: null",
      "nonce: 1",
      "expires: 1234567890000000000",
      'action: {"type":"CreateVault","owner":"DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB","vault_address":"Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU","policy":{"per_tx_limit":[["SOL","50000000"]],"daily_cap":[["SOL","100000000"]],"programs":["11111111111111111111111111111111","ComputeBudget111111111111111111111111111111"],"max_priority_fee_lamports":"100000","max_memo_len":64,"expires_at_ns":"2000000000000000000","loosen_delay_ns":"3600000000000"}}',
    ].join("\n");

    const parsed = parseAdminMessage(msg);
    expect(parsed.network).toBe("near-testnet");
    expect(parsed.contract).toBe("guard.djume.testnet");
    expect(parsed.vault).toBe(null);
    expect(parsed.nonce).toBe(1);
    expect(parsed.expiry).toBe(1234567890000000000n);
    expect(parsed.action.type).toBe("CreateVault");
  });

  it("parses valid AddAgent message", () => {
    const msg = [
      "SANA-GUARD-ADMIN-v1",
      "network: near-testnet",
      "contract: guard.djume.testnet",
      "vault: 0",
      "nonce: 2",
      "expires: 1234567890000000000",
      'action: {"type":"AddAgent","vault_id":0,"name":"agent1","public_key":"ed25519:9F5UPZQb...","gas_funding":"20000000000000000000000"}',
    ].join("\n");

    const parsed = parseAdminMessage(msg);
    expect(parsed.vault).toBe(0);
    expect(parsed.action.type).toBe("AddAgent");
  });

  it("rejects wrong header", () => {
    const msg = [
      "WRONG-HEADER",
      "network: near-testnet",
      "contract: guard.djume.testnet",
      "vault: null",
      "nonce: 1",
      "expires: 1234567890000000000",
      'action: {"type":"CreateVault"}',
    ].join("\n");

    expect(() => parseAdminMessage(msg)).toThrow("wrong header");
  });

  it("rejects message with wrong number of lines", () => {
    const msg = [
      "SANA-GUARD-ADMIN-v1",
      "network: near-testnet",
      "contract: guard.djume.testnet",
      "vault: null",
    ].join("\n");

    expect(() => parseAdminMessage(msg)).toThrow("expected 7 lines");
  });

  it("parses BackfillRecipients", () => {
    const msg = [
      "SANA-GUARD-ADMIN-v1",
      "network: near-testnet",
      "contract: guard.djume.testnet",
      "vault: 0",
      "nonce: 6",
      "expires: 1234567890000000000",
      'action: {"type":"BackfillRecipients","vault_id":0,"recipients":["DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB"]}',
    ].join("\n");
    const parsed = parseAdminMessage(msg);
    expect(parsed.action.type).toBe("BackfillRecipients");
  });

  it("rejects nonce like 10abc", () => {
    const msg = [
      "SANA-GUARD-ADMIN-v1",
      "network: near-testnet",
      "contract: guard.djume.testnet",
      "vault: 0",
      "nonce: 10abc",
      "expires: 1234567890000000000",
      'action: {"type":"Pause","vault_id":0}',
    ].join("\n");
    expect(() => parseAdminMessage(msg)).toThrow("Invalid nonce");
  });

  it("rejects a line that only contains the field value without the prefix", () => {
    const msg = [
      "SANA-GUARD-ADMIN-v1",
      "near-testnet",
      "contract: guard.djume.testnet",
      "vault: 0",
      "nonce: 1",
      "expires: 1234567890000000000",
      'action: {"type":"Pause","vault_id":0}',
    ].join("\n");
    expect(() => parseAdminMessage(msg)).toThrow("Missing network:");
  });

  it("rejects unknown action types", () => {
    const msg = [
      "SANA-GUARD-ADMIN-v1",
      "network: near-testnet",
      "contract: guard.djume.testnet",
      "vault: 0",
      "nonce: 1",
      "expires: 1234567890000000000",
      'action: {"type":"StealFunds","vault_id":0}',
    ].join("\n");
    expect(() => parseAdminMessage(msg)).toThrow("Unknown action type");
  });

  it("rejects invalid action JSON", () => {
    const msg = [
      "SANA-GUARD-ADMIN-v1",
      "network: near-testnet",
      "contract: guard.djume.testnet",
      "vault: null",
      "nonce: 1",
      "expires: 1234567890000000000",
      "action: {invalid json",
    ].join("\n");

    expect(() => parseAdminMessage(msg)).toThrow("Invalid action JSON");
  });
});

describe("verifySignature", () => {
  it("verifies valid signature", () => {
    const keyPair = nacl.sign.keyPair();
    const msg = "test message";
    const signature = nacl.sign.detached(
      new TextEncoder().encode(msg),
      keyPair.secretKey
    );
    const ownerB58 = bs58.encode(keyPair.publicKey);

    expect(verifySignature(msg, signature, ownerB58)).toBe(true);
  });

  it("rejects invalid signature", () => {
    const keyPair = nacl.sign.keyPair();
    const msg = "test message";
    const wrongSignature = new Uint8Array(64);
    const ownerB58 = bs58.encode(keyPair.publicKey);

    expect(verifySignature(msg, wrongSignature, ownerB58)).toBe(false);
  });

  it("rejects signature with wrong length", () => {
    const keyPair = nacl.sign.keyPair();
    const msg = "test message";
    const wrongSignature = new Uint8Array(32);
    const ownerB58 = bs58.encode(keyPair.publicKey);

    expect(verifySignature(msg, wrongSignature, ownerB58)).toBe(false);
  });

  it("rejects invalid owner pubkey", () => {
    const signature = new Uint8Array(64);
    const msg = "test message";

    expect(verifySignature(msg, signature, "invalid-base58")).toBe(false);
  });
});
