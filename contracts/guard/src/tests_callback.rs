// MPC callback tests
use crate::types::*;
use crate::*;
use near_sdk::json_types::U64;
use near_sdk::test_utils::accounts;
use near_sdk::PromiseError;

fn setup_contract_with_request() -> (Guard, [u8; 32]) {
    let mut contract = Guard::new(
        "v1.signer-prod.testnet".parse().unwrap(),
        1,
        "near-testnet".to_string(),
        accounts(0),
    );

    let req_id = [42u8; 32];
    let request = SignRequest {
        vault_id: 0,
        agent: accounts(1),
        msg_hash: [1u8; 32],
        spend: vec![(Mint::Sol, 100_000_000)],
        hour: 1000,
        status: Status::Pending,
        signature: None,
        created_ns: 1_000_000_000,
    };

    // Create vault with spend reservation
    let mut vault = Vault::new(
        0,
        [1u8; 32],
        [2u8; 32],
        "test/path".to_string(),
        Policy {
            per_tx_limit: vec![(Mint::Sol, U64(1_000_000_000))],
            daily_cap: vec![(Mint::Sol, U64(10_000_000_000))],
            max_priority_fee_lamports: U64(1_000_000),
            max_total_priority_fee_lamports: None,
            max_memo_len: 100,
            expires_at_ns: U64(u64::MAX),
            loosen_delay_ns: U64(3_600_000_000_000),
            programs: vec![],
        },
    );

    // Add reservation to bucket
    let spend = vec![(types::Mint::Sol, 100_000_000)];
    vault.bucket_spend.insert(1000, spend);
    let hashes = vec![[0u8; 32]];
    vault.bucket_hashes.insert(1000, hashes);
    contract.vaults.insert(0, vault);

    contract.requests.insert(req_id, request);

    (contract, req_id)
}

#[cfg(test)]
mod callback_tests {
    use super::*;

    #[test]
    fn test_handle_signed_callback_success() {
        let (mut contract, req_id) = setup_contract_with_request();

        // Simulate successful MPC response
        let result = Ok(MpcSignature::Ed25519 {
            signature: vec![9u8; 64],
        });

        let signature = contract.handle_signed_callback(req_id, result);

        assert!(signature.is_some());
        assert_eq!(signature.unwrap().len(), 64);

        // Verify request status
        let request = contract.requests.get(&req_id).unwrap();
        assert!(matches!(request.status, Status::Signed));
        assert_eq!(request.signature.as_ref().unwrap().len(), 64);
    }

    #[test]
    fn test_handle_signed_callback_failure_doesnt_panic() {
        let (mut contract, req_id) = setup_contract_with_request();

        // Simulate MPC failure
        let result: Result<MpcSignature, PromiseError> = Err(PromiseError::Failed);

        let signature = contract.handle_signed_callback(req_id, result);

        // Signature should be None
        assert!(signature.is_none());

        // Verify request status is Failed
        let request = contract.requests.get(&req_id).unwrap();
        assert!(matches!(request.status, Status::Failed));

        // Verify no panic occurred
    }

    #[test]
    fn test_callback_with_wrong_signature_length() {
        let (mut contract, req_id) = setup_contract_with_request();

        // Wrong signature length (not 64 bytes)
        let result = Ok(MpcSignature::Ed25519 {
            signature: vec![9u8; 32], // Only 32 bytes, not 64
        });

        let signature = contract.handle_signed_callback(req_id, result);

        // Should fail due to wrong length
        assert!(signature.is_none());

        let request = contract.requests.get(&req_id).unwrap();
        assert!(matches!(request.status, Status::Failed));
    }
}
