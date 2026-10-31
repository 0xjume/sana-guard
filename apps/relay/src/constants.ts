// Exact BigInt yocto constants. Never convert through IEEE floats.

export const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;

// Gas units (not yocto). 1 Tgas = 1e12.
export const GAS_100_TGAS = 100_000_000_000_000n;
export const GAS_150_TGAS = 150_000_000_000_000n;

// Prepaid gas is charged at ~1e9 yocto/gas (see E2E: 95 Tgas ≈ 0.096 NEAR).
// Used only as a pre-send reservation ceiling; actual spend is reconciled
// from tokens_burnt on the tx outcome.
export const YOCTO_PER_GAS = 1_000_000_000n;

// Deposits in yoctoNEAR
export const CREATE_VAULT_DEPOSIT = 500_000_000_000_000_000_000_000n; // 0.5 NEAR
export const AGENT_OVERHEAD = 50_000_000_000_000_000_000_000n; // 0.05 NEAR
export const MIN_AGENT_FUNDING = 150_000_000_000_000_000_000_000n; // 0.15 NEAR
export const MAX_AGENT_FUNDING = 500_000_000_000_000_000_000_000n; // 0.5 NEAR

export function maxGasCostYocto(gasUnits: bigint): bigint {
  return gasUnits * YOCTO_PER_GAS;
}

export type NearUnit = "near" | "yocto";

/**
 * Parse an amount into yoctoNEAR.
 * `unit` is required: "near" is a decimal NEAR string ("0.15"),
 * "yocto" is an integer yocto string. No digit-count heuristic.
 */
export function parseNearToYocto(input: string, unit: NearUnit): bigint {
  const trimmed = input.trim();
  if (unit === "yocto") {
    if (!/^\d+$/.test(trimmed)) {
      throw new Error("Invalid yocto amount");
    }
    return BigInt(trimmed);
  }

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid NEAR amount");
  }

  if (!trimmed.includes(".")) {
    return BigInt(trimmed) * YOCTO_PER_NEAR;
  }

  const [whole, fracRaw] = trimmed.split(".");
  if (fracRaw!.length > 24) {
    throw new Error("NEAR amount has more than 24 decimal places");
  }
  return BigInt(whole! + fracRaw!.padEnd(24, "0"));
}

export function yoctoToNearString(yocto: string | bigint): string {
  const value = BigInt(yocto);
  const whole = value / YOCTO_PER_NEAR;
  const frac = (value % YOCTO_PER_NEAR)
    .toString()
    .padStart(24, "0")
    .replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}
