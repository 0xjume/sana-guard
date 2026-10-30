# Sana Guard Testing Documentation

This document describes the testing strategy for the Sana Guard contract, which provides policy-enforced wallet security for AI agents on Solana via NEAR Chain Signatures.

## Test Layers

### 1. Unit Tests (43 tests, ~0.15s)

Quick, focused tests covering core functionality:

```bash
cd contracts/guard
cargo test --lib
```

#### Policy Tests (`tests_policy_comprehensive.rs`)
- **24h rolling cap tests**: Validates hourly bucket spending limits across hour boundaries
- **Per-tx limit tests**: Ensures individual transaction limits are enforced
- **Allowlist tests**: Verifies program and recipient allowlists work correctly
- **Vault expiry tests**: Checks vault expiration timestamp enforcement
- **Kill switch tests**: Validates global and per-vault pause functionality
- **Idempotency tests**: Ensures duplicate signature requests are rejected
- **Policy changes**: Tests stricter policies apply immediately, looser policies require delay

#### Callback Tests (`tests_callback.rs`)
- **MPC signature handling**: Tests successful Ed25519 signature callbacks from MPC contract
- **Error handling**: Validates proper error responses from MPC
- **Malformed signature rejection**: Tests invalid signature length detection

### 2. Parser Tests (`tests_comprehensive.rs`)

Hand-crafted byte fixtures for Solana transaction parsing:

- **Legacy transaction tests**: System transfer, token transfer, memo, unknown instruction
- **Versioned (v0) transaction tests**: All instruction types with address lookup tables
- **Malicious input tests**: Truncated messages, invalid lengths, overflows, corrupted data

These tests ensure the parser never panics on any input and correctly extracts:
- Sender/recipient addresses
- Token amounts and mint addresses
- Priority fees
- Memo content
- Program IDs

### 3. Admin Signature Tests (`tests_admin_signatures.rs`, 10 tests)

Critical tests for owner authentication using deterministic ed25519-dalek keys:

**Valid operations:**
- `CreateVault`: Creates a new vault with policy
- `Pause`: Pauses vault operations
- `SetPolicy`: Updates vault policy (with loosen delay)

**Security tests:**
- Wrong signing key: Different key attempting to sign
- Tampered network: Message network field modified after signing
- Tampered action: Action parameters modified after signing
- Expired message: Timestamp past expiration
- Nonce replay: Reusing same nonce twice
- Lower nonce: Using nonce lower than previously used
- Non-owner vault access: Attacker trying to modify someone else's vault

### 4. Fuzz Tests (`tests_fuzz.rs`)

Randomized testing to catch edge cases:

```bash
# Long fuzz (60s default, configurable with FUZZ_SECS)
cargo test fuzz_parser_no_panic --lib -- --ignored

# Or with custom duration
FUZZ_SECS=300 cargo test fuzz_parser_no_panic --lib -- --ignored
```

Tests:
- **Random bytes**: Pure random input to catch crashes
- **Semi-structured fuzzing**: Randomized valid-looking transactions with corrupted fields

The fuzz test is marked `#[ignore]` so regular `cargo test` runs stay fast (<1s). CI should run the fuzz test separately.

### 5. Continuous Integration

Required checks before merge:

```bash
# Rust checks
cd contracts/guard
cargo test --lib                                    # Unit tests (fast)
cargo test fuzz_parser_no_panic --lib -- --ignored # Fuzz (60s)
cargo clippy --target wasm32-unknown-unknown -- -D warnings
cargo fmt --check

# TypeScript checks (frontend/SDK)
cd ../..
pnpm install
pnpm lint
pnpm typecheck
```

### 6. Testnet Deployment

Deploy to `guard.djume.testnet` for end-to-end testing against the real NEAR MPC signer:

```bash
# Set environment
export NEAR_OWNER_ACCOUNT=djume.testnet
export NEAR_ADMIN_ACCOUNT=djume.testnet
export CONTRACT_ACCOUNT=guard.djume.testnet

# Deploy
./scripts/deploy-testnet.sh
```

The deployment script:
1. Builds with `cargo near build` (or `wasm-opt -Oz --strip-debug`)
2. Reports WASM size (target: <340 KB)
3. Deploys to testnet
4. Initializes with MPC contract address and admin account

#### Testnet Test Checklist

After deployment, manually verify:

1. **Vault creation**: Admin creates vault with policy
2. **Agent registration**: Add agent with gas funding
3. **Transaction signing**: Agent requests signature for valid Solana tx
4. **Policy enforcement**: Agent request rejected for violating per-tx limit
5. **Rolling cap**: Multiple txs rejected after exceeding 24h cap
6. **Allowlist**: Tx rejected for non-whitelisted program
7. **Vault pause**: Owner pauses vault, agent requests blocked
8. **Policy loosen delay**: Owner schedules looser policy, must wait delay period
9. **MPC callback**: Signature request receives valid Ed25519 signature from MPC
10. **Nonce protection**: Duplicate signature request rejected

## Test Coverage Summary

- **53 total unit tests** (10 admin signature, 20+ policy, 10+ parser, 2+ callback, 1 fuzz)
- **Parser**: 100% instruction coverage (transfer, token, memo, unknown)
- **Policy**: All rule types tested (limits, caps, allowlists, expiry, pauses)
- **Auth**: All attack vectors tested (wrong key, tampering, replay, non-owner)
- **Fuzz**: 60s+ random input testing

## Running All Tests

```bash
# Fast tests only (excluding fuzz)
cargo test --lib

# With fuzz (add ~60s)
cargo test --lib -- --ignored --nocapture
cargo test --lib

# CI-equivalent full check
./scripts/ci-check.sh  # (if exists, or run commands above manually)
```

## Test Maintenance

When modifying the contract:

1. **Add parser tests** for new Solana instruction types
2. **Add policy tests** for new spending rules or limits
3. **Add auth tests** for new admin actions
4. **Run fuzz** to catch edge cases
5. **Deploy to testnet** for end-to-end validation

Admin signatures are the security foundation: every new `OwnerAction` variant must have both a valid operation test and attack tests (wrong key, tampered fields).
