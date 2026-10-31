import { PublicKey } from "@solana/web3.js";
import { buildSolTransfer } from "@sana-guard/sdk";
import { describe, expect, it } from "vitest";
import { decodeBase64Tx, extractMessageBytes } from "./tx.js";

describe("extractMessageBytes", () => {
  it("accepts a raw v0 message", () => {
    const from = new PublicKey("11111111111111111111111111111111");
    const to = new PublicKey("11111111111111111111111111111112");
    const message = buildSolTransfer(from, to, 1000n, "Ht6GqHqTWjgDKVVALPWnR1qXaP8Qm7u2abYcGvMxLbGN", {
      version: "v0",
    });
    expect(extractMessageBytes(message)[0]).toBe(0x80);
    const encoded = Buffer.from(message).toString("base64");
    expect(decodeBase64Tx(encoded)[0]).toBe(0x80);
  });
});
