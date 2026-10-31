import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { solanaSignatureBase58 } from "./signature.js";

const raw = Buffer.alloc(64, 7);
const base64 = raw.toString("base64");
const base58 = bs58.encode(raw);

describe("solanaSignatureBase58", () => {
  it("decodes the contract get_request base64 into a Solana base58 signature", () => {
    expect(solanaSignatureBase58(base64)).toBe(base58);
    expect(solanaSignatureBase58(base64)).not.toBe(base64);
  });

  it("passes through an already-base58 64-byte signature", () => {
    expect(solanaSignatureBase58(base58)).toBe(base58);
  });

  it("accepts a raw 64-byte array", () => {
    expect(solanaSignatureBase58(Array.from(raw))).toBe(base58);
  });

  it("returns undefined for missing or unaccountable encodings", () => {
    expect(solanaSignatureBase58(undefined)).toBeUndefined();
    expect(solanaSignatureBase58("already-signed")).toBeUndefined();
    expect(solanaSignatureBase58(Buffer.alloc(32, 1))).toBeUndefined();
  });
});
