use near_sdk::log;
use near_sdk::serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[serde(tag = "event", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum Event {
    VaultCreated {
        vault_id: u32,
        owner: String,
        vault_address: String,
    },
    AgentAdded {
        vault_id: u32,
        agent: String,
    },
    AgentRemoved {
        vault_id: u32,
        agent: String,
    },
    PolicyChanged {
        vault_id: u32,
    },
    PolicyLoosenScheduled {
        vault_id: u32,
        effective_ns: u64,
    },
    Paused {
        vault_id: u32,
    },
    Unpaused {
        vault_id: u32,
    },
    SignRequested {
        req_id: String,
        vault_id: u32,
        agent: String,
        spend: Vec<(String, u64)>,
        msg_hash: String,
    },
    SignRejected {
        req_id: String,
        reason: String,
    },
    Signed {
        req_id: String,
        vault_id: u32,
    },
    SignFailed {
        req_id: String,
        vault_id: u32,
    },
    Released {
        req_id: String,
        vault_id: u32,
    },
}

pub fn emit_event(event: Event) {
    let event_json = serde_json::json!({
        "standard": "sana_guard",
        "version": "1.0.0",
        "event": event,
    });

    log!("EVENT_JSON:{}", event_json.to_string());
}
