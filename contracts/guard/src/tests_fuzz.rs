// Property-based fuzzing tests for parser
#[cfg(test)]
mod fuzz_tests {
    use crate::parser::*;
    
    #[test]
    fn fuzz_parser_no_panic() {
        // Simple fuzzing: try parsing random bytes
        // The parser should never panic, only return Err
        use std::time::{Duration, Instant};
        
        let start = Instant::now();
        let mut count = 0;
        
        // Run for at least 5 seconds
        while start.elapsed() < Duration::from_secs(5) {
            // Generate random message length (0-2000 bytes)
            let len = (count * 17) % 2000;
            let mut msg = vec![0u8; len];
            
            // Fill with pseudo-random data
            for i in 0..len {
                msg[i] = ((count + i) * 251) as u8;
            }
            
            // Should not panic
            let _ = parse_solana_message(&msg);
            
            count += 1;
        }
        
        println!("Fuzz test ran {} iterations", count);
        assert!(count > 1000, "Should run at least 1000 iterations");
    }
    
    #[test]
    fn fuzz_parser_sized_inputs() {
        // Test boundary conditions
        let test_cases = vec![
            vec![],                      // empty
            vec![0],                     // 1 byte
            vec![0; 31],                 // just under min
            vec![0; 32],                 // min valid size
            vec![0; 1167],               // max valid size
            vec![0; 1168],               // just over max
            vec![0; 2000],               // way too large
        ];
        
        for msg in test_cases {
            let _ = parse_solana_message(&msg);
        }
    }
    
    #[test]
    fn fuzz_parser_with_valid_structure() {
        // Fuzz with semi-valid structure
        for seed in 0u32..1000 {
            let mut msg = vec![
                1,  // 1 required sig
                0,  // 0 readonly signed
                (seed % 5) as u8,  // readonly unsigned
                3,  // 3 keys
            ];
            
            // Add 3 account keys
            for _ in 0..3 {
                msg.extend_from_slice(&[(seed as u8); 32]);
            }
            
            // Blockhash
            msg.extend_from_slice(&[(seed.wrapping_add(1) as u8); 32]);
            
            // Random number of instructions
            msg.push((seed % 3) as u8);
            
            // Add random instruction data
            for _ in 0..(seed % 3) {
                msg.push((seed % 3) as u8); // program_id
                msg.push((seed % 4) as u8); // num accounts
                for _ in 0..(seed % 4) {
                    msg.push((seed % 3) as u8);
                }
            let data_len = (seed % 20) as usize;
            msg.push(data_len as u8);
            msg.extend_from_slice(&vec![(seed as u8); data_len]);
            }
            
            // Should not panic
            let _ = parse_solana_message(&msg);
        }
    }
}
