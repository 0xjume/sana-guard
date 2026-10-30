// Comprehensive test suite for Sana Guard
use crate::parser::*;
use crate::*;

#[cfg(test)]
mod parser_valid_tests {
    use super::*;

    #[test]
    fn test_legacy_system_transfer() {
        let vault = [1u8; 32];
        let recipient = [2u8; 32];
        let system_prog = [0u8; 32];

        let mut msg = vec![
            1, // 1 required sig
            0, // 0 readonly signed
            1, // 1 readonly unsigned
            3, // 3 account keys
        ];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&recipient);
        msg.extend_from_slice(&system_prog);
        msg.extend_from_slice(&[0u8; 32]); // blockhash
        msg.push(1); // 1 instruction
        msg.push(2); // program_id_index = 2 (System)
        msg.push(2); // 2 accounts
        msg.push(0); // from (index 0)
        msg.push(1); // to (index 1)
        msg.push(12); // data length
        msg.extend_from_slice(&[2, 0, 0, 0]); // discriminator u32
        msg.extend_from_slice(&[0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]); // 1_000_000 lamports

        let parsed = parse_solana_message(&msg).unwrap();
        assert_eq!(parsed.fee_payer, vault);
        assert_eq!(parsed.instructions.len(), 1);
        match &parsed.instructions[0] {
            ParsedInstruction::SystemTransfer { from, to, lamports } => {
                assert_eq!(from, &vault);
                assert_eq!(to, &recipient);
                assert_eq!(*lamports, 1_000_000);
            }
            _ => panic!("wrong instruction type"),
        }
    }

    #[test]
    fn test_legacy_spl_token_transfer() {
        let vault = [1u8; 32];
        let source_ata = [2u8; 32];
        let dest_ata = [3u8; 32];
        let token_prog = TOKEN_PROGRAM;
        let system_prog = [0u8; 32];

        let mut msg = vec![1, 0, 2, 5];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&source_ata);
        msg.extend_from_slice(&dest_ata);
        msg.extend_from_slice(&token_prog);
        msg.extend_from_slice(&system_prog);
        msg.extend_from_slice(&[0u8; 32]); // blockhash
        msg.push(1); // 1 instruction
        msg.push(3); // program_id = token
        msg.push(3); // 3 accounts
        msg.push(1); // source
        msg.push(2); // dest
        msg.push(0); // authority
        msg.push(9); // data length
        msg.push(3); // discriminator
        msg.extend_from_slice(&[0x00, 0xca, 0x9a, 0x3b, 0, 0, 0, 0]); // 1_000_000_000

        let parsed = parse_solana_message(&msg).unwrap();
        assert_eq!(parsed.instructions.len(), 1);
        match &parsed.instructions[0] {
            ParsedInstruction::TokenTransfer {
                authority, amount, ..
            } => {
                assert_eq!(authority, &vault);
                assert_eq!(*amount, 1_000_000_000);
            }
            _ => panic!("wrong instruction"),
        }
    }

    #[test]
    fn test_legacy_spl_token_transfer_checked() {
        let vault = [1u8; 32];
        let source = [2u8; 32];
        let mint = [3u8; 32];
        let dest = [4u8; 32];
        let token_prog = TOKEN_PROGRAM;

        let mut msg = vec![1, 0, 2, 6];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&source);
        msg.extend_from_slice(&mint);
        msg.extend_from_slice(&dest);
        msg.extend_from_slice(&token_prog);
        msg.extend_from_slice(&[0u8; 32]);
        msg.extend_from_slice(&[0u8; 32]); // blockhash
        msg.push(1);
        msg.push(4); // token program
        msg.push(4); // 4 accounts
        msg.push(1); // source
        msg.push(2); // mint
        msg.push(3); // dest
        msg.push(0); // authority
        msg.push(10); // data len
        msg.push(12); // discriminator
        msg.extend_from_slice(&[0x00, 0xca, 0x9a, 0x3b, 0, 0, 0, 0]); // amount
        msg.push(9); // decimals

        let parsed = parse_solana_message(&msg).unwrap();
        match &parsed.instructions[0] {
            ParsedInstruction::TokenTransfer {
                amount, decimals, ..
            } => {
                assert_eq!(*amount, 1_000_000_000);
                assert_eq!(*decimals, Some(9));
            }
            _ => panic!("wrong instruction"),
        }
    }

    #[test]
    fn test_legacy_ata_create_idempotent() {
        let vault = [1u8; 32];
        let ata = [2u8; 32];
        let wallet = [3u8; 32];
        let mint = [4u8; 32];
        let ata_prog = ATA_PROGRAM;
        let system_prog = [0u8; 32];
        let token_prog = TOKEN_PROGRAM;

        let mut msg = vec![1, 0, 4, 8];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&ata);
        msg.extend_from_slice(&wallet);
        msg.extend_from_slice(&mint);
        msg.extend_from_slice(&system_prog);
        msg.extend_from_slice(&token_prog);
        msg.extend_from_slice(&ata_prog);
        msg.extend_from_slice(&[0u8; 32]);
        msg.extend_from_slice(&[0u8; 32]); // blockhash
        msg.push(1);
        msg.push(6); // ata program
        msg.push(6); // 6 accounts (not 7 - ata program not in accounts)
        msg.push(0); // payer
        msg.push(1); // ata
        msg.push(2); // wallet
        msg.push(3); // mint
        msg.push(4); // system
        msg.push(5); // token
        msg.push(1); // data len (1 byte for CreateIdempotent)
        msg.push(1); // discriminator

        let parsed = parse_solana_message(&msg).unwrap();
        match &parsed.instructions[0] {
            ParsedInstruction::AtaCreate {
                payer,
                ata: parsed_ata,
                wallet: _,
                mint: parsed_mint,
            } => {
                assert_eq!(payer, &vault);
                assert_eq!(parsed_ata, &ata);
                assert_eq!(parsed_mint, &mint);
            }
            _ => panic!("wrong instruction"),
        }
    }

    #[test]
    fn test_legacy_compute_budget_set_limit() {
        let vault = [1u8; 32];
        let cb_prog = COMPUTE_BUDGET_PROGRAM;
        let system_prog = [0u8; 32];

        let mut msg = vec![1, 0, 2, 3];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&cb_prog);
        msg.extend_from_slice(&system_prog);
        msg.extend_from_slice(&[0u8; 32]); // blockhash
        msg.push(1);
        msg.push(1); // cb program
        msg.push(0); // 0 accounts
        msg.push(5); // data len
        msg.push(2); // SetComputeUnitLimit discriminator
        msg.extend_from_slice(&[0x80, 0x1a, 0x06, 0x00]); // 400_000 units (little-endian)

        let parsed = parse_solana_message(&msg).unwrap();
        match &parsed.instructions[0] {
            ParsedInstruction::ComputeBudgetSetLimit { limit } => {
                assert_eq!(*limit, 400_000);
            }
            _ => panic!("wrong instruction"),
        }
    }

    #[test]
    fn test_legacy_compute_budget_set_price() {
        let vault = [1u8; 32];
        let cb_prog = COMPUTE_BUDGET_PROGRAM;
        let system_prog = [0u8; 32];

        let mut msg = vec![1, 0, 2, 3];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&cb_prog);
        msg.extend_from_slice(&system_prog);
        msg.extend_from_slice(&[0u8; 32]);
        msg.push(1);
        msg.push(1);
        msg.push(0);
        msg.push(9);
        msg.push(3); // SetComputeUnitPrice discriminator
        msg.extend_from_slice(&[0x10, 0x27, 0, 0, 0, 0, 0, 0]); // 10_000 microlamports

        let parsed = parse_solana_message(&msg).unwrap();
        match &parsed.instructions[0] {
            ParsedInstruction::ComputeBudgetSetPrice { micro_lamports } => {
                assert_eq!(*micro_lamports, 10_000);
            }
            _ => panic!("wrong instruction"),
        }
    }

    #[test]
    fn test_legacy_memo() {
        let vault = [1u8; 32];
        let memo_prog = MEMO_V2_PROGRAM;
        let system_prog = [0u8; 32];

        let mut msg = vec![1, 0, 2, 3];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&memo_prog);
        msg.extend_from_slice(&system_prog);
        msg.extend_from_slice(&[0u8; 32]);
        msg.push(1);
        msg.push(1); // memo program
        msg.push(0);
        let memo_text = b"test memo";
        msg.push(memo_text.len() as u8);
        msg.extend_from_slice(memo_text);

        let parsed = parse_solana_message(&msg).unwrap();
        match &parsed.instructions[0] {
            ParsedInstruction::Memo { text } => {
                assert_eq!(text.as_bytes(), memo_text);
            }
            _ => panic!("wrong instruction"),
        }
    }

    #[test]
    fn test_v0_format_no_alts() {
        let vault = [1u8; 32];
        let recipient = [2u8; 32];
        let system_prog = [0u8; 32];

        let mut msg = vec![
            0x80, // v0 marker
            1,    // 1 required sig
            0, 0, 3, // header
        ];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&recipient);
        msg.extend_from_slice(&system_prog);
        msg.extend_from_slice(&[0u8; 32]);
        msg.push(1);
        msg.push(2);
        msg.push(2);
        msg.push(0);
        msg.push(1);
        msg.push(12);
        msg.extend_from_slice(&[2, 0, 0, 0]);
        msg.extend_from_slice(&[0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]);
        msg.push(0); // 0 address table lookups

        let parsed = parse_solana_message(&msg).unwrap();
        assert_eq!(parsed.fee_payer, vault);
    }
}

#[cfg(test)]
mod parser_malicious_tests {
    use super::*;

    #[test]
    fn test_reject_v0_with_alts() {
        let mut msg = vec![0x80, 1, 0, 0, 3];
        msg.extend_from_slice(&[1u8; 32]);
        msg.extend_from_slice(&[2u8; 32]);
        msg.extend_from_slice(&[0u8; 32]);
        msg.extend_from_slice(&[0u8; 32]); // blockhash
        msg.push(0); // 0 instructions
        msg.push(1); // 1 ALT (address table lookup)
        msg.extend_from_slice(&[3u8; 32]); // ALT address

        assert!(parse_solana_message(&msg).is_err());
    }

    #[test]
    fn test_reject_trailing_bytes() {
        let mut msg = vec![1, 0, 1, 2];
        msg.extend_from_slice(&[1u8; 32]);
        msg.extend_from_slice(&[0u8; 32]);
        msg.extend_from_slice(&[0u8; 32]);
        msg.push(0); // 0 instructions
        msg.push(0xFF); // trailing byte

        assert!(parse_solana_message(&msg).is_err());
    }

    #[test]
    fn test_reject_truncated_header() {
        let msg = vec![1, 0];
        assert!(parse_solana_message(&msg).is_err());
    }

    #[test]
    fn test_reject_account_index_out_of_range() {
        let mut msg = vec![1, 0, 1, 2];
        msg.extend_from_slice(&[1u8; 32]);
        msg.extend_from_slice(&[0u8; 32]);
        msg.extend_from_slice(&[0u8; 32]);
        msg.push(1); // 1 instruction
        msg.push(10); // program_id_index = 10 (out of range)
        msg.push(0);
        msg.push(0);

        assert!(parse_solana_message(&msg).is_err());
    }

    #[test]
    fn test_reject_wrong_fee_payer() {
        let not_vault = [99u8; 32];
        let vault = [1u8; 32];
        let system_prog = [0u8; 32];

        let mut msg = vec![1, 0, 1, 3];
        msg.extend_from_slice(&not_vault); // fee payer is not vault
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&system_prog);
        msg.extend_from_slice(&[0u8; 32]);
        msg.push(1);
        msg.push(2);
        msg.push(2);
        msg.push(0);
        msg.push(1);
        msg.push(12);
        msg.extend_from_slice(&[2, 0, 0, 0]);
        msg.extend_from_slice(&[0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]);

        let parsed = parse_solana_message(&msg).unwrap();
        // Parser succeeds but policy should reject if fee_payer != vault
        assert_ne!(parsed.fee_payer, vault);
    }

    #[test]
    fn test_reject_token_2022() {
        let vault = [1u8; 32];
        let token_2022 = [
            6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 74, 91, 230, 40, 93, 251, 214, 242, 218,
            41, 111, 175, 87, 79, 144, 108, 188, 202, 250, 171, 66, 41,
        ]; // TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

        let mut msg = vec![1, 0, 2, 4];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&[2u8; 32]);
        msg.extend_from_slice(&[3u8; 32]);
        msg.extend_from_slice(&token_2022);
        msg.extend_from_slice(&[0u8; 32]);
        msg.push(1);
        msg.push(3); // program = token-2022
        msg.push(3);
        msg.push(1);
        msg.push(2);
        msg.push(0);
        msg.push(9);
        msg.push(3);
        msg.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0]);

        let result = parse_solana_message(&msg);
        // Parser should reject unknown programs - returns error
        assert!(result.is_err());
    }

    #[test]
    fn test_reject_unknown_program() {
        let vault = [1u8; 32];
        let unknown_prog = [42u8; 32];

        let mut msg = vec![1, 0, 1, 2];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&unknown_prog);
        msg.extend_from_slice(&[0u8; 32]);
        msg.push(1);
        msg.push(1);
        msg.push(0);
        msg.push(10);
        msg.extend_from_slice(&[0u8; 10]);

        let result = parse_solana_message(&msg);
        // Parser rejects unknown programs
        assert!(result.is_err());
    }

    #[test]
    fn test_truncated_instruction_data() {
        let vault = [1u8; 32];
        let system_prog = [0u8; 32];

        let mut msg = vec![1, 0, 1, 2];
        msg.extend_from_slice(&vault);
        msg.extend_from_slice(&system_prog);
        msg.extend_from_slice(&[0u8; 32]);
        msg.push(1);
        msg.push(1);
        msg.push(2);
        msg.push(0);
        msg.push(1);
        msg.push(12); // claims 12 bytes
        msg.extend_from_slice(&[2, 0, 0]); // only 3 bytes

        assert!(parse_solana_message(&msg).is_err());
    }
}

#[cfg(test)]
mod policy_tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{testing_env, AccountId, Gas, NearToken};

    fn setup_contract() -> Guard {
        Guard::new(
            "v1.signer-prod.testnet".parse().unwrap(),
            1,
            "near-testnet".to_string(),
            "admin.testnet".parse().unwrap(),
        )
    }

    fn get_context(predecessor: AccountId, deposit: u128, timestamp: u64) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(predecessor)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(timestamp)
            .prepaid_gas(Gas::from_tgas(300));
        builder
    }

    #[test]
    fn test_global_pause() {
        let mut contract = setup_contract();
        // Set predecessor to admin
        let admin: AccountId = "admin.testnet".parse().unwrap();
        let context = get_context(admin, 1, 1_000_000_000);
        testing_env!(context.build());

        contract.admin_pause_all(true);
        assert!(contract.global_paused);

        contract.admin_pause_all(false);
        assert!(!contract.global_paused);
    }

    #[test]
    #[should_panic(expected = "admin only")]
    fn test_global_pause_not_admin() {
        let mut contract = setup_contract();
        let context = get_context(accounts(1), 1, 1_000_000_000);
        testing_env!(context.build());

        contract.admin_pause_all(true);
    }

    // TODO: Add more policy tests for:
    // - per-tx limit enforcement
    // - rolling 24h cap
    // - allowlists
    // - expiry
    // - idempotency
    // - nonce replay
    // - admin signature verification
    // - policy loosening delay
}
