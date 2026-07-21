use wasm_bindgen::prelude::*;
use anyrepair::{repair_with_format, detect_format};

/// Repair input with explicit format.
/// Format can be: json, xml, yaml, toml, csv, markdown, ini, diff, properties, env.
/// Returns the repaired string, or empty string on failure.
#[wasm_bindgen]
pub fn repair_with(input: &str, format: &str) -> String {
    repair_with_format(input, format).unwrap_or_default()
}

/// Repair any supported format with auto-detection.
/// Returns the repaired string, or empty string on failure.
#[wasm_bindgen]
pub fn repair(input: &str) -> String {
    anyrepair::repair(input).unwrap_or_default()
}

// ── Format-specific convenience wrappers ────────────────────────────────

macro_rules! repair_fn {
    ($name:ident, $fmt:literal) => {
        #[wasm_bindgen]
        pub fn $name(input: &str) -> String {
            repair_with_format(input, $fmt).unwrap_or_default()
        }
    };
}

repair_fn!(repair_json, "json");
repair_fn!(repair_xml, "xml");
repair_fn!(repair_yaml, "yaml");
repair_fn!(repair_toml, "toml");
repair_fn!(repair_csv, "csv");
repair_fn!(repair_markdown, "markdown");
repair_fn!(repair_ini, "ini");
repair_fn!(repair_diff, "diff");
repair_fn!(repair_properties, "properties");
repair_fn!(repair_env, "env");

/// Detect the format of the given content.
/// Returns the format name ("json", "xml", "yaml", "toml", "csv", "markdown", "ini", "diff", "properties", "env")
/// or empty string if no format detected.
#[wasm_bindgen]
pub fn detect(input: &str) -> String {
    detect_format(input).map(|s| s.to_string()).unwrap_or_default()
}
