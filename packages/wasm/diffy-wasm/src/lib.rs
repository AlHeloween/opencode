use wasm_bindgen::prelude::*;

/// Compute a unified diff patch between two texts.
/// Returns the patch as a string in unified format.
#[wasm_bindgen]
pub fn diff_create_patch(original: &str, modified: &str) -> String {
    let patch = diffy::create_patch(original, modified);
    patch.to_string()
}

/// Apply a patch to a base text. Returns the patched text.
#[wasm_bindgen]
pub fn diff_apply(base: &str, patch_text: &str) -> Result<String, JsValue> {
    let patch = diffy::Patch::from_str(patch_text)
        .map_err(|e| JsValue::from_str(&format!("parse error: {}", e)))?;
    diffy::apply(base, &patch)
        .map_err(|e| JsValue::from_str(&format!("apply error: {}", e)))
}

/// Parse a patch from unified diff text into structured JSON.
/// Returns array of file patches with hunks.
#[wasm_bindgen]
pub fn diff_parse(patch_text: &str) -> String {
    let patch = match diffy::Patch::from_str(patch_text) {
        Ok(p) => p,
        Err(_) => return "[]".into(),
    };
    let hunks: Vec<HunkJson> = patch
        .hunks()
        .iter()
        .map(|h| HunkJson {
            old_start: h.old_range().start(),
            old_count: h.old_range().len(),
            new_start: h.new_range().start(),
            new_count: h.new_range().len(),
            lines: h
                .lines()
                .iter()
                .map(|l| match l {
                    diffy::Line::Context(s) => LineJson {
                        kind: "context".into(),
                        content: s.to_string(),
                    },
                    diffy::Line::Insert(s) => LineJson {
                        kind: "insert".into(),
                        content: s.to_string(),
                    },
                    diffy::Line::Delete(s) => LineJson {
                        kind: "delete".into(),
                        content: s.to_string(),
                    },
                })
                .collect(),
        })
        .collect();
    serde_json::to_string(&hunks).unwrap_or_else(|_| "[]".into())
}

/// Count additions and deletions in a diff.
/// Returns JSON: {"additions": N, "deletions": M}
#[wasm_bindgen]
pub fn diff_stats(original: &str, modified: &str) -> String {
    let patch = diffy::create_patch(original, modified);
    let mut adds = 0usize;
    let mut dels = 0usize;
    for hunk in patch.hunks() {
        for line in hunk.lines() {
            match line {
                diffy::Line::Insert(_) => adds += 1,
                diffy::Line::Delete(_) => dels += 1,
                _ => {}
            }
        }
    }
    serde_json::json!({ "additions": adds, "deletions": dels }).to_string()
}

#[derive(serde::Serialize)]
struct HunkJson {
    old_start: usize,
    old_count: usize,
    new_start: usize,
    new_count: usize,
    lines: Vec<LineJson>,
}

#[derive(serde::Serialize)]
struct LineJson {
    kind: String,
    content: String,
}
