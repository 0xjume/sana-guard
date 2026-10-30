import { describe, it, expect } from "vitest";
import { NearClientImpl } from "./client.js";

const isLive = process.env.RELAY_LIVE === "1";

describe.skipIf(!isLive)("NearClientImpl (live view calls only)", () => {
  let client: NearClientImpl;

  if (isLive) {
    client = new NearClientImpl(
      "testnet",
      "https://rpc.testnet.near.org",
      "relay.djume.testnet",
      process.env.RELAY_NEAR_PRIVATE_KEY || "ed25519:unused",
      "guard.djume.testnet"
    );
  }

  it("fetches owner nonce", async () => {
    const nonce = await client.getOwnerNonce(
      "DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB"
    );
    expect(typeof nonce).toBe("number");
    expect(nonce).toBeGreaterThanOrEqual(0);
  }, 30000);

  it("fetches vault 0 if it exists", async () => {
    const vault = await client.getVault(0);
    if (vault) {
      expect(vault).toHaveProperty("owner");
      expect(vault).toHaveProperty("vault_address");
      expect(vault).toHaveProperty("policy");
    }
  }, 30000);

  it("returns null for non-existent vault", async () => {
    const vault = await client.getVault(99999);
    expect(vault).toBe(null);
  }, 30000);
});
