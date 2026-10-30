# Sana Guard: research notes and citations

Compiled Fri Oct 30, 2026 (WIB, UTC+7). Everything was gathered read-only: no accounts, repos, deploys or funds were used.
Legend: **VERIFIED** = checked this session against chain state or source. **SOURCE** = read in code or docs. **UNVERIFIED** = needs a spike.

---

## 1. MPC signer contract (Chain Signatures)

### 1.1 Contract names and state (VERIFIED, read-only RPC, Oct 30 2026, about 13:50–14:00 WIB)

| | Testnet | Mainnet |
|---|---|---|
| Account | `v1.signer-prod.testnet` | `v1.signer` |
| `version` | `3.17.0` | `3.17.0` |
| code_hash | `DAE5ng4ZFR2ctMx9SizQBqmGkVbKUutgZ4ZECD4R8Sm9` | same |
| Domains | 0 = CaitSith/secp256k1 (Sign), **1 = Frost/Ed25519 (Sign)**, 2 = CKD (bls12381), 3 = CaitSith (ForeignTx) | same layout |
| Ed25519 root (domain 1) | `ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2` | `ed25519:G9hwngxWNKdmqMCmU1Yt6LPhFpayJeKFxyAV1HqMNLtF` |
| `latest_key_version` | 3 | (not queried) |
| threshold / epoch | 11 / 27 | – / 14 |

- `v1.signer.testnet` does **not** exist (UNKNOWN_ACCOUNT). Use `v1.signer-prod.testnet`.
- On-chain `config` (testnet), VERIFIED:
  - `sign_call_gas_attachment_requirement_tera_gas: 15`. The README says 10; the live config wins, so attach at least 15 Tgas and use 30–50 Tgas for headroom.
  - `return_signature_and_clean_state_on_success_call_tera_gas: 7`
  - `fail_on_timeout_tera_gas: 2`
- Source repo: github.com/near/mpc, shallow clone at `/workspace/refs-mpc`. HEAD is 5ddffcc (Oct 29 2026), with workspace version 3.18.0, which is newer than the deployed 3.17.0.

Reproduce with:
```bash
curl -s https://rpc.testnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"v1.signer-prod.testnet","method_name":"config","args_base64":"e30="}}'
```

### 1.2 `sign` request shape (SOURCE plus on-chain examples)

From `refs-mpc/crates/contract/README.md` (lines 57–100 and 272–300) and `crates/contract/src/api/sign.rs`:
```json
{ "request": {
    "path": "vault/<owner_solana_pubkey_b58>/<vault_id>",
    "payload_v2": { "Eddsa": "<hex of the FULL Solana message bytes, 32..=1232 bytes>" },
    "domain_id": 1 } }
```
- `#[payable]`, requires **≥ 1 yoctoNEAR** deposit (`SIGN_DEPOSIT_YOCTONEAR`); excess is refunded (README line 57).
- Frost (Ed25519) domains **require** the `Eddsa` payload. The legacy `payload` / `key_version` args are ECDSA-only (README line 298).
- MPC `respond` verifies the EdDSA signature over the **raw payload bytes** against the derived key. So we pass the Solana *message* (not a hash), and the result is a valid Solana tx signature.
- **Duplicates:** the same (caller, domain, path, payload) while pending is queued and shares one response. The queue is bounded by `MAX_PENDING_REQUEST_FAN_OUT = 128` (`crates/contract/src/pending_requests.rs:35`); beyond that you get `PendingRequestQueueFull`.
- **Timeout:** the callback `return_signature_and_clean_state_on_success` receives `Err(PromiseError)` and returns a `fail_on_timeout` promise, so our callback sees a failed promise (`sign.rs:199-219`).
  - The yield timeout is about 200 blocks per the skill `near-smart-contracts/rules/yield-resume.md`. It is UNVERIFIED for the current protocol, so measure it.

### 1.3 Response shape (VERIFIED on-chain)

`crates/near-mpc-crypto-types/src/primitives.rs:167-171`:
```rust
#[serde(tag = "scheme")]
pub enum SignatureResponse { Secp256k1(K256Signature), Ed25519 { signature: Ed25519Signature } }
```
Live testnet `respond` tx `2ZBKSPXWJsZx4JABGbcoa5CVwtVvJKwa6Fc4rDBxbi5C` (domain 1, Eddsa payload) carries:
```json
"response": {"scheme":"Ed25519","signature":[87,187,78, ... 64 u8 ...]}
```
⚠️ The skill text (`near-smart-contracts/rules/chain-signatures.md`) shows `{"Ed25519":{"signature":[...]}}`. That shape is **wrong** for the deployed 3.17.0, so deserialize the internally tagged form:
```rust
#[near(serializers=[json])]
#[serde(tag = "scheme")]
pub enum MpcSignature {
    Ed25519 { signature: Vec<u8> },   // len must be 64
    Secp256k1 { /* unused */ big_r: serde_json::Value, s: serde_json::Value, recovery_id: u8 },
}
```

### 1.4 Key derivation (VERIFIED offline == on-chain)

Sources: `refs-mpc/crates/near-mpc-crypto-types/src/kdf.rs` and `crates/contract/src/crypto_shared/kdf.rs`.
```
tweak  = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:" + predecessor_id + "," + path)  -> scalar (LE, mod L)
derived = root_ed25519_point + tweak * G         (compressed 32 bytes == Solana address, base58)
```
`/workspace/derive.py` (venv `/workspace/.venv`, pynacl and base58):
```python
import hashlib, base58, nacl.bindings as b
def derive(root_b58, predecessor, path):
    root = base58.b58decode(root_b58.split(':')[1])
    t = hashlib.sha3_256(f"near-mpc-recovery v0.1.0 epsilon derivation:{predecessor},{path}".encode()).digest()
    L = 2**252 + 27742317777372353535851937790883648493
    s = (int.from_bytes(t,'little') % L).to_bytes(32,'little')
    return base58.b58encode(b.crypto_core_ed25519_add(root, b.crypto_scalarmult_ed25519_base_noclamp(s))).decode()
```
- Check: `derived_public_key({"path":"vault/test/1","predecessor":"guard.djume.testnet","domain_id":1})` returns `ed25519:5Ui8uVLUYmgJPvUUyMjHoiAACJ44uizMEyx5TVQKG6HJ`, which matches the offline derivation.
- So **vault addresses can be precomputed before guard.djume.testnet exists**. The predecessor is the guard contract, because the guard calls MPC.
- Production code should call the view `derived_public_key` (SDK) and *not* derive inside the contract. The contract only needs the vault address stored at `create_vault` time, set by the relay and then cross-checked; see PLAN §3.

### 1.5 Deposit and function-call keys (VERIFIED, docs)

- docs.near.org/protocol/access-keys: "Function-Call keys … **do not allow to attach NEAR tokens to the call**."
- The MPC README (line 59) mentions "a function-call key with an explicit deposit allowance". Nothing in the current docs exposes such a key type; the docs mention *gas keys* (prepaid gas, parallel nonces), not deposit.
- So an agent's FC key **cannot** attach the 1 yocto. **Design:** the guard contract attaches 1 yocto from its own balance on the outgoing `Promise` to MPC.
  - This is a normal contract-originated receipt deposit, but it is UNVERIFIED live; it is day-1 spike S1.
- Same page: a contract can add keys to itself via `promise_batch_action_add_key_with_function_call`, where allowance `0` means unlimited in that host function. The guard can therefore mint agent keys itself (option A), or create agent subaccounts (option B).

## 2. near-sdk and tooling versions (VERIFIED via crates.io and npm, Oct 30 2026)

| crate/pkg | latest |
|---|---|
| near-sdk | **5.30.0** (Oct 27 2026) |
| cargo-near | 0.22.0 |
| near-workspaces | 0.24.0 |
| near-api (rust) | 0.8.7 |
| omni-transaction (rust) | 0.5.0. It has a `solana` module with builder/encoder only (`refs-omni/src/solana`) and no decoder, so it is useful for test fixtures. |
| solana-message | 6.0.0 (too heavy for wasm; don't use in contract) |
| near-api-js | 7.4.0 |
| near-kit | 0.20.2 |
| chainsig.js | 1.1.16 |
| @solana/kit | 8.6.0 |
| @privy-io/react-auth | 3.51.0 |

- `near_sdk::env::ed25519_verify(signature: &[u8;64], message: impl AsRef<[u8]>, public_key: &[u8;32]) -> bool` is VERIFIED on docs.rs/near-sdk/5.30.0. It was already present in earlier 5.x releases; the minimum version was not checked.
- `near_sdk::env::signer_account_pk() -> PublicKey` is VERIFIED on docs.rs 5.30.0.
- Skill idioms (from `~/.agents/skills/near-smart-contracts/SKILL.md` and its rules):
  - `#[near(contract_state)]`, `#[near(serializers=[json,borsh])]`, `PanicOnDefault`, `#[private]` callbacks, `#[callback_result]`
  - `near_sdk::store::{IterableMap, LookupMap, LookupSet}` with unique `BorshStorageKey` prefixes
  - `overflow-checks = true` in the release profile
  - `cargo near new` / `cargo near build`

## 3. Audit checklist source

`~/.agents/skills/near-contract-audit/SKILL.md` and `references/{high,medium,low}-severity.md`. The detectors are:
- **High:** non-private-callback, reentrancy, incorrect-argument-or-return-types (U64/U128 in JSON), unsaved-changes, owner-check, yocto-attach, storage-collision, required-initialization-macro
- **Medium:** gas-griefing, insecure-random, prepaid-gas
- **Low:** cover-storage-cost, unsafe-math, float-math

They are mapped to Sana Guard in PLAN §7.

## 4. Solana message format (SOURCE)

Refs: `/home/box/solana-refs/solana-dev-skill/skills/solana-dev/references/concepts.md` (wire format, lines ~40-90) and `transactions-v1.md`.

- **Tx** = shortvec(sigs[64]) + message (legacy/v0). The contract receives and signs **the message only**.
- **Legacy message:** `header[3]` (num_required_signatures, num_readonly_signed, num_readonly_unsigned) + shortvec(account keys ×32) + recent_blockhash[32] + shortvec(instructions{program_id_index u8, shortvec(account idx u8), shortvec(data)}).
- **v0 message:** first byte `0x80`, then the same fields as legacy plus a trailing shortvec(address_table_lookups). **Sana Guard v1 requires lookups to be empty**, since ALT-resolved addresses are invisible to the contract.
- **⚠️ Solana transaction format "v1"** (SIMD-0385/0296) was activated on mainnet **2026-09-15** (Agave 4.2.2):
  - The tx starts with `0x81`, signatures are at the tail, and the message has a config mask (budget is not in ComputeBudget instructions).
  - Size can go up to 4096 bytes, which is above the MPC Eddsa payload max of 1232.
  - **Reject version byte ≥ 0x81** in the MVP, and force the SDK to build `version: 0` or legacy. @solana/kit plugin clients may default to v1 (`transactionConfig: {version: 1}` is "the default for new code" in that skill).
  - Whether v1 is active on devnet was not checked.
- **shortvec / compact-u16:** 7 bits per byte, LE, at most 3 bytes. Reject non-canonical encodings and values > u16.
- **Blockhash expiry:** about 150 slots, roughly 60 s (`solana-new/skills/data/solana-knowledge/03-contract-level.md:335`, `02-...:329`). Durable nonce means `SystemProgram::AdvanceNonceAccount` must be instruction 0 (`kit/programs/system.md:22`, `kit/advanced.md:212`).
- **Instruction encodings.** System Transfer = u32 LE 2 + u64 lamports, 12 bytes. This is VERIFIED in `refs-omni/src/solana/utils.rs:20-33` and `constants.rs` (System id = 32 zero bytes, v0 prefix 0x80, PACKET_DATA_SIZE 1232). SPL Token, Token-2022, ATA and ComputeBudget ids appear in the solana refs. The remaining discriminators are the standard layouts and still need fixture tests:

| Program | ID | Ix | Data | Accounts |
|---|---|---|---|---|
| System | `11111111111111111111111111111111` | Transfer | u32 LE `2` + u64 lamports (12 bytes) | [from (s,w), to (w)] |
| System | same | AdvanceNonceAccount | u32 LE `4` | [nonce (w), recent_blockhashes sysvar, authority (s)] |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Transfer | u8 `3` + u64 amount | [source (w), dest (w), owner (s)] |
| SPL Token | same | TransferChecked | u8 `12` + u64 amount + u8 decimals | [source (w), mint, dest (w), owner (s)] |
| ATA | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | CreateIdempotent | u8 `1` (or empty = Create) | [payer (s,w), ata (w), wallet, mint, system, token program] |
| ComputeBudget | `ComputeBudget111111111111111111111111111111` | SetComputeUnitLimit `2` u32 / SetComputeUnitPrice `3` u64 µlamports | – | none |
| Memo v2 | `MemoSq4gqABAXKb96qnH8TufNbR35NAkW8wK6xWmSLjU` (v1 `Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo`) | utf8 bytes | signer accounts only |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | – | **rejected in MVP** (transfer hooks/fees) | |

  - **Signed-tx limit:** 1232 bytes *including* shortvec(sigs) + 64 bytes per sig, so a single-signer message must be ≤ 1167 bytes.
  - The Memo v2 id and the SPL/ATA/ComputeBudget discriminators were **not re-checked against code this session**. Day-2 task: assert them with fixtures built by `@solana-program/system` and `@solana-program/token` and by omni-transaction.

## 5. Owner auth (Privy)

- Privy docs (docs.privy.io/wallets/using-wallets/solana/sign-a-message), VERIFIED via web: `useSignMessage()` from `@privy-io/react-auth/solana`, `signMessage({message: Uint8Array, wallet, options})` returns `{signature: Uint8Array}`. `showWalletUIs:false` hides the modal.
- UNVERIFIED: that Privy signs the raw bytes with no prefix. Solana wallet-standard `signMessage` normally does, so a spike checks it against `env::ed25519_verify` in a near-workspaces test.

## 6. NEAR Intents / 1Click (for stretch payouts)

- `~/.agents/skills/near-intents/SKILL.md:22,39`: GET /v0/tokens, then POST /v0/quote (`dry:true` is preview only; `dry:false` returns a deposit address valid about 10 min), then deposit, then /v0/deposit/submit, then /v0/status.
- There is no testnet (per the brief), so the demo uses `dry:true` quotes only.

## 7. Relay and keys (near-api-js / near-cli-rs skills)

- `near-api-js/references/key_management.md:204-209`: `account.addFunctionCallAccessKey({publicKey, contractId, methodNames, allowance})`
- `near-cli-rs/SKILL.md:197`: `near account add-key <acct> grant-function-call-access --allowance ... --contract-account-id ... --function-names 'request_sign'`

## 8. Prior canvases built upon
- Design draft: https://cursor.com/canvas/store-76fe2137-632d-4e18-804c-95799f7bf537/c50b5176-60af-4803-895d-b2ea117fc9bf
- Whitepaper v0.1: …/753604d2-a388-441c-bb4b-6189993ed73b
- Idea shortlist: …/d34a09ed-5431-4be4-b13f-66c06f3de723
