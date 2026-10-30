use ed25519_dalek::{Signature, Signer, SigningKey};
use serde::Deserialize;

const FIXTURE: &str =
    include_str!("../../../packages/sdk/src/__tests__/fixtures/admin-messages.json");

#[derive(Deserialize)]
struct FixtureFile {
    cases: Vec<FixtureCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    name: String,
    message: String,
    signature_hex: String,
}

fn action_json(message: &str) -> &str {
    message
        .lines()
        .find(|line| line.starts_with("action: "))
        .map(|line| &line["action: ".len()..])
        .expect("action line")
}

#[test]
fn sdk_admin_fixtures_deserialize_and_verify() {
    let fixtures: FixtureFile = serde_json::from_str(FIXTURE).expect("fixture json");
    assert_eq!(fixtures.cases.len(), 4);

    let signing_key = SigningKey::from_bytes(&[7u8; 32]);
    let verifying_key = signing_key.verifying_key();

    for case in &fixtures.cases {
        let json = action_json(&case.message);
        let parsed: Result<crate::owner::OwnerAction, _> = serde_json::from_str(json);
        parsed.unwrap_or_else(|err| {
            panic!("{} failed OwnerAction serde: {err}; json={json}", case.name)
        });

        let sig_bytes = hex::decode(&case.signature_hex).expect("signature hex");
        let signature = Signature::from_slice(&sig_bytes).expect("64-byte signature");
        verifying_key
            .verify_strict(case.message.as_bytes(), &signature)
            .unwrap_or_else(|err| panic!("{} signature verify failed: {err}", case.name));

        let expected = signing_key.sign(case.message.as_bytes());
        assert_eq!(
            expected.to_bytes().as_slice(),
            sig_bytes.as_slice(),
            "{} signature must match ed25519-dalek over the same bytes",
            case.name
        );
    }
}
