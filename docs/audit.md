# Sana Guard self-audit

Self-audit of the guard contract (`contracts/guard`) and the paths around it, against the threat
model and audit checklist in [PLAN.md §7](./PLAN.md#7-threat-model-and-audit-checklist).

- **Scope:** `contracts/guard` at `main` (`a4f0d97`, deployed as `version()` `0.1.0 / 9cb56bd5c761`
  plus later dashboard-only changes), and the relay, MCP server and dashboard where they touch
  signing or spend.
- **Method:** reading the code against each checklist row, the 131 unit tests and 4
  near-workspaces end-to-end tests, CI, and the reviews of PRs #2–#28. Line references are to
  `main` at the commit above.
- **Not an external audit.** This is the authors' own review. Do not use the deployment with real
  funds.

## Summary

| | Count |
|---|---|
| Threats from PLAN §7 | 12: 8 mitigated, 2 partly mitigated, 2 open |
| Audit-checklist detectors passing | 14 of 14 (one with a caveat, O1) |
| Issues found and fixed during development | 14 (listed below, with PRs) |
| Open findings | 5 (0 high, 2 medium, 3 low) |

The core spend path holds:
- Every rejection happens before any MPC call.
- Spend is reserved before the promise is created and released exactly once.
- Callbacks are private and do not panic.
- Owner actions need an ed25519 signature, an increasing nonce, and matching network and contract
  tags.

The open items are storage growth and missing defence-in-depth, not ways to move funds past
policy.

## Threat model (PLAN §7)

| Threat | Mitigation in code | Evidence | Status |
|---|---|---|---|
| Leaked agent key / prompt-injected agent | Caps, allowlists and expiry enforced in `process_sign_request` before MPC; kill switch; RemoveAgent unbinds the agent | `policy.rs:12`; agent lookup `SG_E052`; `tests_policy_comprehensive.rs`; e2e `policy_violation_is_rejected_before_mpc` | Mitigated |
| Malicious tx hiding transfers (ALTs, v1 format, trailing bytes, unknown programs) | Strict parser: legacy/v0 only, ALT count 0, exact length, ≤ 64 keys, ≤ 8 instructions, supported programs only, per-vault program allowlist | `parser.rs:126` (E002), `:139` (E004), `:148`, `:174`, `:231` (E016), `:236` (E017); `SG_E074`; `tests_comprehensive.rs`, `tests_fuzz.rs` | Mitigated |
| Replay / double accounting | `req_id` unique (E059); message hash unique in a 24h window (E060); Solana itself dedupes signed txs | `policy.rs` E059/E060 checks; `tests_policy_comprehensive.rs` idempotency tests | Mitigated |
| Signed tx never broadcast ("budget leak") | Conservative: counts as spent; owner `Release` after 2 minutes; MPC failure releases automatically, once | `owner.rs:561`; `policy.rs:313`; `tests_release_and_programs.rs`; e2e `mpc_failure_releases_the_reservation` | Mitigated (by design) |
| Relay compromise | Relay only forwards owner-signed messages; cannot forge (ed25519), replay (nonce) or cross-replay (network/contract tags); is not on the `request_sign` path | `owner.rs:86`, `:90`, `:106`, `:112`; README security model | Mitigated (worst case is censorship / DoS) |
| Privy / owner key compromise | Out of scope (equal to owner compromise). Loosening waits `loosen_delay_ns`; tightening and Pause are immediate | `owner.rs:600` `is_policy_stricter`; `tests_policy_stricter.rs` | Accepted, partly mitigated |
| Guard admin key | `djume.testnet` can upgrade the code, which bypasses everything | Disclosed in README | **Open (accepted for testnet), O5** |
| MPC liveness / timeout | `on_signed` releases the reservation on error; MCP refuses expired blockhashes before signing | `policy.rs:313`; `apps/mcp/src/tools.ts` `isBlockhashValid` | Mitigated |
| Blockhash expiry vs MPC latency | MCP pre-checks the blockhash; durable nonce not implemented | PLAN spike S2 not recorded against live MPC | Partly mitigated |
| Gas griefing (huge messages, many instructions) | Size ≤ 1167, ≤ 8 instructions, ≤ 64 keys, ≤ 8 agents, 24 hourly buckets per check; gas guard before the promise | `parser.rs:111`, `:148`, `:174`; `owner.rs:359`; `policy.rs:177` (E066); measured ~10–11 Tgas per `request_sign` in CI | Mitigated |
| Storage DoS (vault / request spam) | CreateVault needs a 0.5 NEAR deposit and an owner signature; relay caps vaults per owner; **no request or bucket pruning** | `owner.rs` deposit check; `apps/relay` `MAX_VAULTS_PER_OWNER` | **Open, O1 and O2** |
| Guard NEAR drained via agent gas | Option B: each agent's own subaccount and function-call key allowance (0.25 NEAR) pay its gas | `owner.rs` AddAgent (`add_access_key_allowance`) | Mitigated |

## Audit checklist (PLAN §7 detectors)

| Detector | Where it applies | Evidence | Result |
|---|---|---|---|
| H non-private-callback | `on_signed`, `on_agent_created`, `on_vault_verified`, `migrate` | All four are `#[private]` (`lib.rs:106–108`, `:206`, `:215`, `:252`) | Pass |
| H reentrancy | `request_sign` → MPC | Spend reserved (`policy.rs:183`) and request stored (`:199`) before the promise (`:239`). The callback re-reads by `req_id` and only acts on `Pending` (or re-reserves a `Released` request that got a late signature, `:351–355`) | Pass |
| H incorrect argument / return types | amounts, timestamps | `U64` / `U128` in JSON; `get_spend_24h` returns `U64` strings (#12) | Pass |
| H unsaved changes | `Vault` in `IterableMap` | Mutations go through `get_mut`; tests read state back after each action | Pass |
| H owner check | `owner_action`, `request_sign`, admin | ed25519 + nonce for owners (`owner.rs:106`, `:112`); predecessor → vault map for agents; `admin == predecessor` (`lib.rs:332`) | Pass |
| H yocto attach | admin methods | `admin_pause_all` requires exactly 1 yocto (`lib.rs:336`). Intentionally not on `request_sign` (function-call keys can't attach) or `owner_action` (signature-authenticated) | Pass (documented exception) |
| H storage collision | per-vault collections | `StorageKey::{Recipients, Programs, Mints, TokenAccts, Buckets, BucketHashes, BucketSpend} { vault }` | Pass |
| H required initialization | `new` | `#[init]` + `PanicOnDefault` (`lib.rs:67`, `:84`) | Pass |
| M gas griefing | parser, buckets, agent lists | Hard bounds above; 24h checks read at most 24 buckets | Pass |
| M insecure randomness | — | No randomness used | Pass |
| M prepaid gas | MPC + callback | `SG_E066` check reserves 50 (MPC) + 15 (callback) + 10 (buffer) Tgas (`lib.rs:62–64`, `policy.rs:177`); e2e tests attach 150 Tgas | Pass |
| L storage cost | vault / recipient / request inserts | Vaults and agents are paid by deposits; requests are paid by the guard balance | Pass with caveat, see O1 |
| L unsafe math | spend sums, fees | `checked_add` / `checked_mul` with `SG_E041`–`E050`; `saturating_mul` for the per-CU cap; `overflow-checks = true` in release | Pass |
| L float math | — | No `f32` / `f64` in the contract | Pass |

### Additional checks (PLAN §7)

- **Parser fuzzing:** `tests_fuzz.rs` runs random and semi-structured inputs. The long run is
  `#[ignore]`d and must be run by hand (`cargo test fuzz_parser_no_panic -- --ignored`); it is not
  in CI.
- **ed25519 malleability:** even if a malleated signature over the same message verified, the
  owner nonce must strictly increase (`owner.rs:112`), so it cannot be replayed.
- **Admin message canonicalization:** the contract verifies the signature over the exact UTF-8
  bytes, then parses them strictly: 7 lines, fixed prefixes, extra lines rejected
  (`owner.rs:190–236`). What is parsed is exactly what was signed. Unknown JSON fields are not
  rejected; see O3.
- **Event-before-panic ordering:** events are emitted after state changes; a panic reverts both.
- **Callbacks never panic:** `on_vault_verified` treats an undecodable MPC key as a mismatch and
  refunds (`lib.rs:499`). The one `unwrap` in `on_agent_created` parses an account id that
  AddAgent already validated.

## Issues found and fixed during development

| PR | Issue | Impact before the fix |
|---|---|---|
| #2 | E2E testnet blockers: CreateVault owner/path, AddAgent funding, deposit handling, ComputeBudget program id, bucket accounting | Core flows failed on testnet |
| #3 | Vault address not verified on-chain; migration needed | A wrong vault address could be stored |
| #4 | Per-vault program allowlist was never enforced | Any supported program was allowed |
| #4 | Reserved spend could be released twice | Daily cap undercounted |
| #7 | AddAgent refunded excess deposit twice | Anyone could drain the guard balance |
| #7 | MPC `ed25519:` prefix not stripped | Every CreateVault stuck pending |
| #7 | Callback refunds went to the guard itself | The paying relay lost deposits |
| #13 | compact-u16 decode did not match Solana `short_vec` | Parser / message mismatch |
| #15, #16 | Memo program id mismatch (v1 vs v2) between contract, SDK and MCP | MCP rejected valid memos and accepted invalid ones |
| #17 | Price-only priority fees not counted toward spend; total fee cap not enforced | An agent could burn vault SOL in fees outside the caps |
| #17 | Reused MCP idempotency key reported success for a different transfer | Agents could report transfers that never happened |
| #18 | Raising or removing the total fee cap applied immediately | Bypassed the loosening delay |
| #24 | `max_priority_fee_lamports` overflow panicked; UI mislabelled its unit | Confusing caps; oversized cap rejected every price |
| #28 | Concurrent CreateVault for the same owner; hosted AddAgent caps and vault-count checks not fail-closed | Relay-paid creates could exceed the hosted caps |

Reviews of the relay (#5), SDK (#6), MCP server (#11) and dashboard (#19, #26) also found and fixed
off-chain issues such as gas units, budget races, request-id loss and missing confirmations. See
those PRs.

## Open findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| O1 | Medium | **No pruning.** `bucket_hashes`, `bucket_spend` and `requests` grow forever; `spent_cursor` is unused. Each accepted `request_sign` stores a `SignRequest` (about 250 bytes, roughly 0.0025 NEAR at 10¹⁹ yoctoNEAR/byte; an estimate) paid from the guard's balance. A compromised agent can keep making small allowed requests until its gas allowance runs out, locking up to roughly 1 NEAR of guard balance per agent before the owner removes it. | Add bounded pruning of buckets older than 24h inside `request_sign` (PLAN: ≤ 24 per call) and a `cleanup(req_ids)` for requests older than 7 days; or require a small storage deposit per request. |
| O2 | Medium | **No per-owner vault cap in the contract.** PLAN §7 lists one; it exists only in the relay and dashboard. Each vault costs its creator a 0.5 NEAR deposit, so this is spam with a price, not free. | Add a contract-level cap per owner, or rely on the deposit and document it. |
| O3 | Low | **Unknown JSON fields accepted** in admin actions and policy (PLAN §3.2 specifies `deny_unknown_fields`). A misspelled optional field such as `max_total_priority_fee_lamports` is silently treated as absent. Not exploitable, because the owner signs the exact text, and since #18 removing a cap is a delayed loosening; but a client bug fails open. | Add `#[serde(deny_unknown_fields)]` to `OwnerAction` and `Policy`. |
| O4 | Low | **Long fuzzing and real-MPC latency not in CI.** The fuzz run is manual, and PLAN spike S2 (MPC latency vs blockhash lifetime) has no recorded numbers. | Run the fuzz job nightly; record S2 against `v1.signer-prod.testnet`. |
| O5 | Low (testnet) | **Upgradeable by a single admin key.** Disclosed. | Before mainnet: lock the contract account or move upgrades to a multisig / DAO. |

### Operational note

The hosted demo vault 0 uses a compute-unit price cap of 100,000 lamports/CU with no total
priority-fee cap. Since #17, fees count toward its 0.05 SOL per-tx and 0.1 SOL daily caps, so this
is not a way around the policy. A tighter showcase setting is a 1 lamport/CU price cap with a
1,000,000 lamport (0.001 SOL) total cap; tightening applies immediately.
