# Demo video script (2–3 minutes)

Record this against the **live** stack: dashboard https://guard.sana.bot, contract `guard.djume.testnet`, Solana **devnet**. Every beat below exists in the current code. Do not invent UI, extra attack kinds, or an agent path through the relay.

Target length: **2:30–2:50**. Shoot 1920×1080, cursor visible, no secret values on screen.

## Pre-recording checklist

**Funded accounts (no key material in the video or this file)**

- [ ] `agent1.guard.djume.testnet` has enough testnet NEAR for `request_sign` (~0.1+ NEAR; prepaid gas is ~95 Tgas)
- [ ] Vault `Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU` has devnet SOL (live vault 0 was ~0.91 SOL)
- [ ] `relay.djume.testnet` is above the relay floor (live health uses `RELAY_BALANCE_FLOOR_NEAR`)
- [ ] You can sign in as vault 0's owner (`DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB`). The kill-switch card only renders when the Privy session owner matches `vault.owner`. A different Privy wallet still sees policy + Attack lab (read-only)

**Env vars that must already be set (names only — never show values)**

On the hosted dashboard (Vercel). Attack lab is disabled unless all four demo vars are present. Live `GET /api/attack-lab` is `{ enabled: true, vaultId: 0 }`.

| Name | Why |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Login |
| `PRIVY_APP_SECRET` | Owner-action session |
| `INVITE_TOKEN` | Relay CreateVault / AddAgent gate (server-only) |
| `ATTACK_LAB_TOKEN` | Attack lab POST header |
| `DEMO_AGENT_ACCOUNT_ID` | Attack lab agent |
| `DEMO_AGENT_PRIVATE_KEY` | Attack lab key (server-only) |
| `DEMO_AGENT_VAULT_ID` | Pinned to `0` |
| `MAX_RELAY_VAULTS_TOTAL` | Hosted cap (live `10`) |
| `MAX_VAULTS_PER_OWNER` | Hosted cap (live `1`) |
| `MAX_AGENTS_PER_VAULT` | Hosted cap (live `3`) |
| `MAX_AGENT_GAS_FUNDING_NEAR` | Hosted cap (live `0.25`) |

For the allowed-transfer beat (MCP or SDK), on the recorder machine:

| Name | Why |
| --- | --- |
| `NEAR_NETWORK` | `testnet` |
| `NEAR_RPC_URL` | NEAR RPC |
| `GUARD_CONTRACT_ID` | `guard.djume.testnet` |
| `NEAR_ACCOUNT_ID` | `agent1.guard.djume.testnet` |
| `NEAR_KEY_FILE` or `NEAR_PRIVATE_KEY` | Agent FC key |
| `SANA_GUARD_VAULT_ID` | `0` |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` |

**Do not film:** `PRIVY_APP_SECRET`, `INVITE_TOKEN`, `ATTACK_LAB_TOKEN`, `DEMO_AGENT_PRIVATE_KEY`, `NEAR_PRIVATE_KEY`, `RELAY_NEAR_PRIVATE_KEY`, or any `.env` file. Type the Attack lab token into the password field with the value hidden (the input is `type="password"`).

**Also**

- [ ] `https://guard.sana.bot` is in the Privy app's allowed origins (login fails on the custom domain if it is not)
- [ ] Attack lab token is on a second device / password manager, not in the terminal
- [ ] After recording, **Unpause** vault 0 if you paused it
- [ ] Transfer amount ≤ 0.05 SOL and recipient = `DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB` (the live allowlist)

---

## Script

### 0:00–0:15 — Cold open

**On screen:** Browser at https://guard.sana.bot. Title **Sana Guard**. Header **Sign in**.

**Voiceover:** "AI agents with hot wallets get drained the moment a key leaks or a prompt is injected. Sana Guard is a policy-enforced agent wallet. A NEAR contract is the only signer. The agent never holds the Solana key."

### 0:15–0:35 — Log in with Privy

**On screen:** Click header **Sign in** (desktop) or the hero **Sign in as owner**. Complete the Privy modal (email or Solana wallet). After auth, the header shows the Solana address chip.

**URL:** `https://guard.sana.bot`

**Voiceover:** "Owners log in with Privy. That embedded Solana wallet signs admin messages. The relay pays NEAR gas. The agent key is a different, narrowly scoped function-call key."

### 0:35–1:00 — Vault 0 and policy

**On screen:** Open https://guard.sana.bot/vaults/0 (works without being the owner). Hover the tiles, then the **Enforced limits** card.

Confirm these labels (live `get_vault` + UI):

| UI label | Expected |
| --- | --- |
| Header | `Vault 0` · badge `Active` |
| Path | `vault/DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB/0` |
| Per-tx SOL | `0.05 SOL` |
| Rolling 24h SOL cap | `0.1 SOL` |
| Max compute-unit price | `100000 lamports / CU` |
| Max total priority fee / tx | `No cap` |
| Expiry | `2026-11-29 12:17:41 UTC` |
| Loosen delay | `1h` |
| Programs | `System`, `Compute Budget` |
| Recipients | `DeF8KC…8XMvmB` |
| Agents | `1` |
| Vault address | `Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU` |

**Voiceover:** "Vault zero. Five hundredths of a SOL per transaction, a tenth of a SOL rolling twenty-four hours, one allowlisted recipient, System and Compute Budget only. Tightening is instant. Loosening waits an hour."

### 1:00–1:35 — Allowed transfer

**On screen:** Split or cut to a terminal / Cursor MCP session. Then open the Solana explorer link the tool returns.

**MCP (preferred):**

```text
sana_guard_check_transfer
  kind: sol
  to: DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB
  amount: "5000"

sana_guard_transfer_sol
  to: DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB
  amount: "5000"
```

**SDK equivalent** (after `pnpm --filter @sana-guard/sdk build`):

```ts
await client.transfer(0, {
  to: new PublicKey('DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB'),
  lamports: 5000n,
});
// log result.explorer
```

Open the returned URL, which looks like:

`https://explorer.solana.com/tx/<signature>?cluster=devnet`

A previously landed sample (same vault, 5000 lamports, confirmed):

https://explorer.solana.com/tx/5w6yEG25bVffWMFERM4LF9oJVmtGutZqbC1WrA7bx43UWvEJcCeFueU9xDaYkNrLuRrVkySSjQZcm5FsuBY1CX1r?cluster=devnet

**Voiceover:** "The agent asks the guard to sign a five-thousand-lamport transfer to the allowlisted owner. The contract parses the Solana message, the MPC signs, we broadcast on devnet. Here is the explorer link."

If MCP is not wired in the recording environment, keep this pre-landed explorer tab as a cutaway and say it is a recorded vault-0 signature — do not fake a dashboard "send" button. The dashboard does not sign allowed spends.

### 1:35–2:10 — Attack lab

**On screen:** Back on https://guard.sana.bot/vaults/0. Scroll to **Try to break the policy** / kicker **Attack lab**. Paste the token into **Attack Lab token** (password field). Click **Over per-tx limit**.

Wait for the result card. Success heading is exactly **Blocked by guard**. Expected code:

`SG_E062_PER_TX_LIMIT_EXCEEDED`

Optional second click, if time: **Non-allowlisted recipient** → `SG_E067_RECIPIENT_NOT_ALLOWED`. Other buttons on this page: **Disallowed program** → `SG_E074_PROGRAM_NOT_ALLOWED`, **Oversized priority fee** → `SG_E072_PRIORITY_FEE_TOO_HIGH`. There is no replay button.

**Voiceover:** "Attack lab. Same demo agent, a transaction over the per-tx cap. The guard rejects it. Blocked by guard, E-zero-six-two. No signature. A prompt injection cannot spend past the contract."

If the heading is **Request refused** / **Request failed**, stop and fix (token, rate limit of 8/60s, or demo agent NEAR). Do not narrate a bypass.

### 2:10–2:35 — Kill switch

**On screen:** Only if signed in as vault 0 owner. Right rail, **Danger zone** / **Kill switch**. Click **Pause vault**. Confirm the header badge flips to **Paused**.

If you are not the owner, the page shows **Read-only view** and no Pause button — do not improvise. Sign in with the owner wallet first, or skip this beat and say the control is owner-signed `Pause` via the relay.

**Voiceover:** "Kill switch. The owner pauses the vault. New agent signatures fail with vault-paused, E-zero-five-five, until we unpause."

### 2:35–2:50 — Wrap-up

**On screen:** Unpause if you paused. End on https://guard.sana.bot/vaults/0 and, if it fits, https://testnet.nearblocks.io/address/guard.djume.testnet.

**Voiceover:** "Sana Guard. Policy on NEAR, signatures from the MPC, Solana as the settlement rail. Testnet and devnet today. The contract is the only signer. Thank you."

---

## Shot list (one line each)

| T | Action | URL / command |
| --- | --- | --- |
| 0:00 | Home | `https://guard.sana.bot` |
| 0:15 | Privy **Sign in** | same |
| 0:35 | Vault 0 policy | `https://guard.sana.bot/vaults/0` |
| 1:00 | Allowed 5000-lamport transfer | `sana_guard_transfer_sol` or SDK `transfer` |
| 1:20 | Explorer | returned `?cluster=devnet` URL |
| 1:35 | Attack lab **Over per-tx limit** | same vault page |
| 1:50 | **Blocked by guard** + `SG_E062_PER_TX_LIMIT_EXCEEDED` | result card |
| 2:10 | **Pause vault** | Kill switch card |
| 2:35 | Unpause, contract explorer | `https://testnet.nearblocks.io/address/guard.djume.testnet` |

## Out of scope (do not show)

- CreateVault / AddAgent (relay-funded; hosted caps 1 vault / owner, 10 total, 3 agents, 0.25 NEAR)
- Mainnet, 1Click, durable nonce, design-preview (`/design-preview` is 404 in production)
- Relay logs, Vercel env, or any secret-bearing file
- Private Sana product code or dashboards
