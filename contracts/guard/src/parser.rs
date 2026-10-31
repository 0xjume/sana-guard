use crate::types::Mint;

pub const SYSTEM_PROGRAM: [u8; 32] = [0; 32];
// Decoded from base58 at compile time
pub const TOKEN_PROGRAM: [u8; 32] = [
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237,
    95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
];

pub const ATA_PROGRAM: [u8; 32] = [
    140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218,
    255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
];

pub const COMPUTE_BUDGET_PROGRAM: [u8; 32] = [
    3, 6, 70, 111, 229, 33, 23, 50, 255, 236, 173, 186, 114, 195, 155, 231, 188, 140, 229, 187,
    197, 247, 18, 107, 44, 67, 155, 58, 64, 0, 0, 0,
];

pub const MEMO_V2_PROGRAM: [u8; 32] = [
    5, 74, 83, 80, 248, 93, 200, 130, 214, 20, 165, 86, 114, 120, 138, 41, 109, 223, 30, 171, 171,
    208, 166, 6, 120, 136, 73, 50, 244, 238, 246, 160,
];

pub const SUPPORTED_PROGRAMS: &[[u8; 32]] = &[
    SYSTEM_PROGRAM,
    TOKEN_PROGRAM,
    ATA_PROGRAM,
    COMPUTE_BUDGET_PROGRAM,
    MEMO_V2_PROGRAM,
];

const ATA_RENT_LAMPORTS: u64 = 2_039_280;

#[derive(Debug)]
pub struct ParsedMessage {
    pub fee_payer: [u8; 32],
    pub instructions: Vec<ParsedInstruction>,
}

#[derive(Debug)]
pub enum ParsedInstruction {
    SystemTransfer {
        from: [u8; 32],
        to: [u8; 32],
        lamports: u64,
    },
    TokenTransfer {
        #[allow(dead_code)]
        source: [u8; 32],
        dest: [u8; 32],
        authority: [u8; 32],
        mint: [u8; 32],
        amount: u64,
        #[allow(dead_code)]
        decimals: Option<u8>,
    },
    AtaCreate {
        payer: [u8; 32],
        ata: [u8; 32],
        #[allow(dead_code)]
        wallet: [u8; 32],
        mint: [u8; 32],
    },
    ComputeBudgetSetLimit {
        limit: u32,
    },
    ComputeBudgetSetPrice {
        micro_lamports: u64,
    },
    Memo {
        text: String,
    },
}

impl ParsedInstruction {
    /// Each variant is decoded from exactly one program, so the program id is implied.
    pub fn program_id(&self) -> [u8; 32] {
        match self {
            ParsedInstruction::SystemTransfer { .. } => SYSTEM_PROGRAM,
            ParsedInstruction::TokenTransfer { .. } => TOKEN_PROGRAM,
            ParsedInstruction::AtaCreate { .. } => ATA_PROGRAM,
            ParsedInstruction::ComputeBudgetSetLimit { .. }
            | ParsedInstruction::ComputeBudgetSetPrice { .. } => COMPUTE_BUDGET_PROGRAM,
            ParsedInstruction::Memo { .. } => MEMO_V2_PROGRAM,
        }
    }
}

/// Decodes a policy's program allowlist. Every entry must be a base58 32-byte key
/// that is one of SUPPORTED_PROGRAMS.
pub fn decode_policy_programs(programs: &[String]) -> Result<Vec<[u8; 32]>, &'static str> {
    programs
        .iter()
        .map(|p| {
            let bytes = bs58::decode(p)
                .into_vec()
                .map_err(|_| "SG_E075_INVALID_POLICY_PROGRAM")?;
            let key: [u8; 32] = bytes
                .try_into()
                .map_err(|_| "SG_E075_INVALID_POLICY_PROGRAM")?;
            if !SUPPORTED_PROGRAMS.contains(&key) {
                return Err("SG_E075_INVALID_POLICY_PROGRAM");
            }
            Ok(key)
        })
        .collect()
}

pub fn parse_solana_message(bytes: &[u8]) -> Result<ParsedMessage, &'static str> {
    if bytes.len() < 32 || bytes.len() > 1167 {
        return Err("SG_E001_SIZE");
    }

    let mut cursor = 0;

    let version = bytes[cursor];
    cursor += 1;

    let is_v0 = if version & 0x80 == 0 {
        cursor -= 1;
        false
    } else if version == 0x80 {
        true
    } else {
        return Err("SG_E002_UNSUPPORTED_VERSION");
    };

    if cursor + 3 > bytes.len() {
        return Err("SG_E003_TRUNCATED_HEADER");
    }

    let num_required_signatures = bytes[cursor];
    let num_readonly_signed = bytes[cursor + 1];
    let num_readonly_unsigned = bytes[cursor + 2];
    cursor += 3;

    if num_required_signatures != 1 {
        return Err("SG_E004_MULTI_SIG");
    }
    if num_readonly_signed != 0 {
        return Err("SG_E005_READONLY_SIGNER");
    }

    let (num_keys, key_count_len) = read_compact_u16(&bytes[cursor..])?;
    cursor += key_count_len;

    if num_keys == 0 || num_keys > 64 {
        return Err("SG_E006_KEY_COUNT");
    }
    if num_readonly_unsigned as u16 >= num_keys {
        return Err("SG_E007_READONLY_COUNT");
    }

    let keys_start = cursor;
    let keys_end = keys_start + (num_keys as usize * 32);
    if keys_end > bytes.len() {
        return Err("SG_E008_TRUNCATED_KEYS");
    }

    let keys = &bytes[keys_start..keys_end];
    cursor = keys_end;

    let fee_payer = get_key(keys, 0)?;

    if cursor + 32 > bytes.len() {
        return Err("SG_E009_TRUNCATED_BLOCKHASH");
    }
    cursor += 32;

    let (num_instructions, ix_count_len) = read_compact_u16(&bytes[cursor..])?;
    cursor += ix_count_len;

    if num_instructions == 0 || num_instructions > 8 {
        return Err("SG_E010_IX_COUNT");
    }

    let mut instructions = Vec::with_capacity(num_instructions as usize);

    for _ in 0..num_instructions {
        if cursor >= bytes.len() {
            return Err("SG_E011_TRUNCATED_IX");
        }

        let program_id_index = bytes[cursor];
        cursor += 1;

        if program_id_index as usize >= num_keys as usize || program_id_index == 0 {
            return Err("SG_E012_INVALID_PROGRAM_INDEX");
        }

        let program_id = get_key(keys, program_id_index)?;

        let (num_accounts, acc_len) = read_compact_u16(&bytes[cursor..])?;
        cursor += acc_len;

        let accounts_start = cursor;
        let accounts_end = accounts_start + num_accounts as usize;
        if accounts_end > bytes.len() {
            return Err("SG_E013_TRUNCATED_ACCOUNTS");
        }
        let account_indices = &bytes[accounts_start..accounts_end];
        cursor = accounts_end;

        for &idx in account_indices {
            if idx as usize >= num_keys as usize {
                return Err("SG_E014_INVALID_ACCOUNT_INDEX");
            }
        }

        let (data_len, data_len_len) = read_compact_u16(&bytes[cursor..])?;
        cursor += data_len_len;

        let data_start = cursor;
        let data_end = data_start + data_len as usize;
        if data_end > bytes.len() {
            return Err("SG_E015_TRUNCATED_DATA");
        }
        let data = &bytes[data_start..data_end];
        cursor = data_end;

        let parsed = parse_instruction(program_id, account_indices, data, keys)?;
        instructions.push(parsed);
    }

    if is_v0 {
        let (num_lookups, lookups_len) = read_compact_u16(&bytes[cursor..])?;
        cursor += lookups_len;

        if num_lookups != 0 {
            return Err("SG_E016_ALT_NOT_ALLOWED");
        }
    }

    if cursor != bytes.len() {
        return Err("SG_E017_TRAILING_BYTES");
    }

    Ok(ParsedMessage {
        fee_payer,
        instructions,
    })
}

fn parse_instruction(
    program_id: [u8; 32],
    accounts: &[u8],
    data: &[u8],
    keys: &[u8],
) -> Result<ParsedInstruction, &'static str> {
    if program_id == SYSTEM_PROGRAM {
        parse_system_instruction(accounts, data, keys)
    } else if program_id == TOKEN_PROGRAM {
        parse_token_instruction(accounts, data, keys)
    } else if program_id == ATA_PROGRAM {
        parse_ata_instruction(accounts, data, keys)
    } else if program_id == COMPUTE_BUDGET_PROGRAM {
        parse_compute_budget_instruction(data)
    } else if program_id == MEMO_V2_PROGRAM {
        parse_memo_instruction(data)
    } else {
        Err("SG_E018_UNKNOWN_PROGRAM")
    }
}

fn parse_system_instruction(
    accounts: &[u8],
    data: &[u8],
    keys: &[u8],
) -> Result<ParsedInstruction, &'static str> {
    if data.len() < 4 {
        return Err("SG_E019_SYSTEM_DATA_TOO_SHORT");
    }

    let discriminator = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);

    if discriminator == 2 {
        if data.len() != 12 {
            return Err("SG_E020_SYSTEM_TRANSFER_LENGTH");
        }
        if accounts.len() != 2 {
            return Err("SG_E021_SYSTEM_TRANSFER_ACCOUNTS");
        }

        let lamports = u64::from_le_bytes([
            data[4], data[5], data[6], data[7], data[8], data[9], data[10], data[11],
        ]);

        Ok(ParsedInstruction::SystemTransfer {
            from: get_key(keys, accounts[0])?,
            to: get_key(keys, accounts[1])?,
            lamports,
        })
    } else {
        Err("SG_E022_SYSTEM_UNSUPPORTED")
    }
}

fn parse_token_instruction(
    accounts: &[u8],
    data: &[u8],
    keys: &[u8],
) -> Result<ParsedInstruction, &'static str> {
    if data.is_empty() {
        return Err("SG_E023_TOKEN_DATA_EMPTY");
    }

    let discriminator = data[0];

    if discriminator == 3 {
        if data.len() != 9 {
            return Err("SG_E024_TOKEN_TRANSFER_LENGTH");
        }
        if accounts.len() != 3 {
            return Err("SG_E025_TOKEN_TRANSFER_ACCOUNTS");
        }

        let amount = u64::from_le_bytes([
            data[1], data[2], data[3], data[4], data[5], data[6], data[7], data[8],
        ]);

        Ok(ParsedInstruction::TokenTransfer {
            source: get_key(keys, accounts[0])?,
            dest: get_key(keys, accounts[1])?,
            authority: get_key(keys, accounts[2])?,
            mint: [0; 32],
            amount,
            decimals: None,
        })
    } else if discriminator == 12 {
        if data.len() != 10 {
            return Err("SG_E026_TOKEN_TRANSFER_CHECKED_LENGTH");
        }
        if accounts.len() != 4 {
            return Err("SG_E027_TOKEN_TRANSFER_CHECKED_ACCOUNTS");
        }

        let amount = u64::from_le_bytes([
            data[1], data[2], data[3], data[4], data[5], data[6], data[7], data[8],
        ]);
        let decimals = data[9];

        Ok(ParsedInstruction::TokenTransfer {
            source: get_key(keys, accounts[0])?,
            dest: get_key(keys, accounts[2])?,
            authority: get_key(keys, accounts[3])?,
            mint: get_key(keys, accounts[1])?,
            amount,
            decimals: Some(decimals),
        })
    } else {
        Err("SG_E028_TOKEN_UNSUPPORTED")
    }
}

fn parse_ata_instruction(
    accounts: &[u8],
    data: &[u8],
    keys: &[u8],
) -> Result<ParsedInstruction, &'static str> {
    if !data.is_empty() && data[0] != 1 {
        return Err("SG_E029_ATA_UNSUPPORTED");
    }

    if accounts.len() != 6 {
        return Err("SG_E030_ATA_ACCOUNTS");
    }

    Ok(ParsedInstruction::AtaCreate {
        payer: get_key(keys, accounts[0])?,
        ata: get_key(keys, accounts[1])?,
        wallet: get_key(keys, accounts[2])?,
        mint: get_key(keys, accounts[3])?,
    })
}

fn parse_compute_budget_instruction(data: &[u8]) -> Result<ParsedInstruction, &'static str> {
    if data.is_empty() {
        return Err("SG_E031_CB_DATA_EMPTY");
    }

    let discriminator = data[0];

    if discriminator == 2 {
        if data.len() != 5 {
            return Err("SG_E032_CB_LIMIT_LENGTH");
        }
        let limit = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
        Ok(ParsedInstruction::ComputeBudgetSetLimit { limit })
    } else if discriminator == 3 {
        if data.len() != 9 {
            return Err("SG_E033_CB_PRICE_LENGTH");
        }
        let micro_lamports = u64::from_le_bytes([
            data[1], data[2], data[3], data[4], data[5], data[6], data[7], data[8],
        ]);
        Ok(ParsedInstruction::ComputeBudgetSetPrice { micro_lamports })
    } else {
        Err("SG_E034_CB_UNSUPPORTED")
    }
}

fn parse_memo_instruction(data: &[u8]) -> Result<ParsedInstruction, &'static str> {
    let text = std::str::from_utf8(data).map_err(|_| "SG_E035_MEMO_INVALID_UTF8")?;
    Ok(ParsedInstruction::Memo {
        text: text.to_string(),
    })
}

/// Solana short_vec / compact-u16. Matches `solana_short_vec::decode_shortu16_len`
/// / `visit_byte`: 7 payload bits per byte, `0x80` continuation, at most 3 bytes,
/// reject alias encodings (trailing zero continuation bytes), overflow, and a
/// continuation bit on the third byte.
pub(crate) fn read_compact_u16(bytes: &[u8]) -> Result<(u16, usize), &'static str> {
    if bytes.is_empty() {
        return Err("SG_E036_COMPACT_EMPTY");
    }

    let mut val: u16 = 0;
    for nth_byte in 0..3 {
        let Some(&elem) = bytes.get(nth_byte) else {
            return Err("SG_E037_COMPACT_TRUNCATED");
        };

        // Non-canonical alias: extra bytes whose payload is zero (e.g. 0x80 0x00).
        if elem == 0 && nth_byte != 0 {
            return Err("SG_E038_COMPACT_TRUNCATED");
        }

        let elem_val = u32::from(elem & 0x7f);
        let elem_done = elem & 0x80 == 0;

        if nth_byte == 2 && !elem_done {
            return Err("SG_E038_COMPACT_TRUNCATED");
        }

        let shift = (nth_byte as u32).saturating_mul(7);
        let shifted = elem_val
            .checked_shl(shift)
            .ok_or("SG_E038_COMPACT_TRUNCATED")?;
        let new_val = u32::from(val) | shifted;
        val = u16::try_from(new_val).map_err(|_| "SG_E038_COMPACT_TRUNCATED")?;

        if elem_done {
            return Ok((val, nth_byte + 1));
        }
    }

    Err("SG_E038_COMPACT_TRUNCATED")
}

fn get_key(keys: &[u8], index: u8) -> Result<[u8; 32], &'static str> {
    let start = (index as usize) * 32;
    let end = start + 32;

    if end > keys.len() {
        return Err("SG_E039_KEY_INDEX_OUT_OF_BOUNDS");
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&keys[start..end]);
    Ok(key)
}

/// Compute units the runtime grants per instruction when no SetComputeUnitLimit is present.
const DEFAULT_COMPUTE_UNITS_PER_IX: u64 = 200_000;
/// Runtime ceiling on a transaction's compute unit limit.
const MAX_COMPUTE_UNIT_LIMIT: u64 = 1_400_000;

/// Priority fee in lamports the vault pays for these instructions.
///
/// The fee is charged on the requested compute unit limit, not on usage. Without an explicit
/// SetComputeUnitLimit the runtime default applies, which this over-estimates by counting every
/// instruction at the full per-instruction default (newer runtimes grant builtins less).
pub fn priority_fee_lamports(instructions: &[ParsedInstruction]) -> Result<u64, &'static str> {
    let mut limit: Option<u64> = None;
    let mut price: Option<u64> = None;
    for ix in instructions {
        match ix {
            ParsedInstruction::ComputeBudgetSetLimit { limit: l } => limit = Some(*l as u64),
            ParsedInstruction::ComputeBudgetSetPrice { micro_lamports } => {
                price = Some(*micro_lamports)
            }
            _ => {}
        }
    }
    let Some(price) = price else {
        return Ok(0);
    };
    let limit = limit.unwrap_or_else(|| {
        (instructions.len() as u64 * DEFAULT_COMPUTE_UNITS_PER_IX).min(MAX_COMPUTE_UNIT_LIMIT)
    });
    // Solana rounds up: (limit * price + 999_999) / 1_000_000
    Ok(limit
        .checked_mul(price)
        .ok_or("SG_E049_OVERFLOW")?
        .checked_add(999_999)
        .ok_or("SG_E049_OVERFLOW")?
        / 1_000_000)
}

pub fn calculate_spend(
    instructions: &[ParsedInstruction],
    vault_address: &[u8; 32],
) -> Result<Vec<(Mint, u64)>, &'static str> {
    let mut spend_map: std::collections::HashMap<Mint, u64> = std::collections::HashMap::new();
    let mut compute_limit: Option<u32> = None;
    let mut compute_price: Option<u64> = None;

    for ix in instructions {
        match ix {
            ParsedInstruction::SystemTransfer { from, lamports, .. } => {
                if from != vault_address {
                    return Err("SG_E040_WRONG_FROM");
                }
                *spend_map.entry(Mint::Sol).or_insert(0) = spend_map
                    .get(&Mint::Sol)
                    .unwrap_or(&0)
                    .checked_add(*lamports)
                    .ok_or("SG_E041_OVERFLOW")?;
            }
            ParsedInstruction::TokenTransfer {
                authority,
                mint,
                amount,
                ..
            } => {
                if authority != vault_address {
                    return Err("SG_E042_WRONG_AUTHORITY");
                }
                let mint_key = if mint == &[0u8; 32] {
                    return Err("SG_E043_MINT_UNKNOWN");
                } else {
                    Mint::Spl(*mint)
                };
                *spend_map.entry(mint_key).or_insert(0) = spend_map
                    .get(&mint_key)
                    .unwrap_or(&0)
                    .checked_add(*amount)
                    .ok_or("SG_E044_OVERFLOW")?;
            }
            ParsedInstruction::AtaCreate { payer, .. } => {
                if payer != vault_address {
                    return Err("SG_E045_WRONG_PAYER");
                }
                *spend_map.entry(Mint::Sol).or_insert(0) = spend_map
                    .get(&Mint::Sol)
                    .unwrap_or(&0)
                    .checked_add(ATA_RENT_LAMPORTS)
                    .ok_or("SG_E046_OVERFLOW")?;
            }
            ParsedInstruction::ComputeBudgetSetLimit { limit } => {
                if compute_limit.is_some() {
                    return Err("SG_E047_DUPLICATE_CB_LIMIT");
                }
                compute_limit = Some(*limit);
            }
            ParsedInstruction::ComputeBudgetSetPrice { micro_lamports } => {
                if compute_price.is_some() {
                    return Err("SG_E048_DUPLICATE_CB_PRICE");
                }
                compute_price = Some(*micro_lamports);
            }
            ParsedInstruction::Memo { .. } => {}
        }
    }

    if compute_price.is_some() {
        // Add 5000 lamport base fee per signature (1 signature per tx)
        let total_fee = priority_fee_lamports(instructions)?
            .checked_add(5_000)
            .ok_or("SG_E050_OVERFLOW")?;

        *spend_map.entry(Mint::Sol).or_insert(0) = spend_map
            .get(&Mint::Sol)
            .unwrap_or(&0)
            .checked_add(total_fee)
            .ok_or("SG_E050_OVERFLOW")?;
    }

    Ok(spend_map.into_iter().collect())
}
