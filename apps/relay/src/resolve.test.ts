import { describe, it, expect } from "vitest";
import { createUnknownResolver, spentAfterOutcome, TX_VALIDITY_MS } from "./resolve.js";
import type { NearClient, TxStatusResult, VaultInfo } from "./near/interface.js";
import { RelayDatabase } from "./db.js";
import { unlink } from "fs/promises";

class SlowNear implements NearClient {
  delayMs = 50;
  calls = 0;
  async getBalance(): Promise<string> {
    return "0";
  }
  async getOwnerNonce(): Promise<number> {
    return 0;
  }
  async getOwnerVaultCount(): Promise<number> {
    return 0;
  }
  async getDerivedPublicKey(): Promise<string> {
    return "ed25519:11111111111111111111111111111111";
  }
  async getVault(): Promise<VaultInfo | null> {
    return null;
  }
  async submitOwnerAction(): Promise<never> {
    throw new Error("not used");
  }
  async getTransactionStatus(): Promise<TxStatusResult> {
    this.calls++;
    await new Promise((r) => setTimeout(r, this.delayMs));
    return { status: "pending" };
  }
}

describe("TX_VALIDITY_MS", () => {
  it("is a 24 hour window", () => {
    expect(TX_VALIDITY_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("spentAfterOutcome", () => {
  it("adds deposit + burnt on success and burnt only on failure", () => {
    expect(
      spentAfterOutcome({
        depositYocto: "500",
        tokensBurntYocto: "30",
        success: true,
      })
    ).toBe("530");
    expect(
      spentAfterOutcome({
        depositYocto: "500",
        tokensBurntYocto: "30",
        success: false,
      })
    ).toBe("30");
  });
});

describe("createUnknownResolver overlap guard", () => {
  it("does not start a second run while the first is in flight", async () => {
    const db = new RelayDatabase("sqlite:./test-resolve.db");
    const now = Date.now();
    db.reserveBudget("o", 1, "Pause", "1", now);
    db.markUnknown("o", 1, "hash");
    const near = new SlowNear();
    const resolve = createUnknownResolver(db, near);

    const first = resolve();
    const second = resolve();
    await Promise.all([first, second]);

    expect(near.calls).toBe(1);
    db.close();
    await unlink("./test-resolve.db").catch(() => {});
  });
});
