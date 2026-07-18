crate::ix!();

use wasm_bindgen::prelude::*;

/// Repair malformed JSON string (LLM output, truncation, etc).
/// Returns valid JSON string, or empty string on failure.
#[wasm_bindgen]
pub fn json_repair(input: &str) -> String {
    match repair_json_string(input) {
        Ok(value) => serde_json::to_string(&value).unwrap_or_default(),
        Err(_) => String::new(),
    }
}
