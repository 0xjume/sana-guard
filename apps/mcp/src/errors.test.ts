import { SanaGuardSignError } from "@sana-guard/sdk";
import { describe, expect, it } from "vitest";
import { structuredFromUnknown } from "./errors.js";
import { generateIdempotencyKey } from "./tools.js";

describe("structuredFromUnknown", () => {
  it("keeps requestId and explains E068 / E077", () => {
    const requestId = generateIdempotencyKey();
    const signed = structuredFromUnknown(
      new SanaGuardSignError("Token transfer recipient not in allowlist", requestId, "SG_E068_RECIPIENT_NOT_ALLOWED")
    );
    expect(signed.requestId).toBe(requestId);
    expect(signed.code).toBe("SG_E068_RECIPIENT_NOT_ALLOWED");
    expect(signed.why).toMatch(/ATA/);

    const exists = structuredFromUnknown(new Error("Smart contract panicked: SG_E077_AGENT_EXISTS"));
    expect(exists.code).toBe("SG_E077_AGENT_EXISTS");
    expect(exists.why).toMatch(/already registered/);
  });
});
