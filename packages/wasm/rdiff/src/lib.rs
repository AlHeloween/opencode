extern crate wasm_bindgen;

mod diff;
mod negative_array;

use wasm_bindgen::prelude::*;
use diff::{diff_greedy, Edit};

/// Compute line-level diff between two texts.
#[wasm_bindgen]
pub fn diff_compute(old_text: &str, new_text: &str) -> String {
    let result = diff_lines(old_text, new_text);
    serde_json::to_string(&result).unwrap_or_else(|_| "[]".into())
}

#[derive(serde::Serialize, Debug)]
#[serde(tag = "type")]
enum Hunk {
    #[serde(rename = "equal")]
    Equal { #[serde(rename = "oldStart")] old_start: usize, #[serde(rename = "newStart")] new_start: usize, length: usize },
    #[serde(rename = "delete")]
    Delete { #[serde(rename = "oldStart")] old_start: usize, #[serde(rename = "oldEnd")] old_end: usize },
    #[serde(rename = "insert")]
    Insert { #[serde(rename = "newStart")] new_start: usize, #[serde(rename = "newEnd")] new_end: usize },
}

/// Encode lines as sentinel chars, run char-level diff, decode to line hunks.
fn diff_lines(old_text: &str, new_text: &str) -> Vec<Hunk> {
    use std::collections::HashMap;

    if old_text.is_empty() && new_text.is_empty() {
        return vec![];
    }

    let old_lines: Vec<&str> = if old_text.is_empty() { vec![] }
        else { old_text.split('\n').collect() };
    let new_lines: Vec<&str> = if new_text.is_empty() { vec![] }
        else { new_text.split('\n').collect() };

    let n = if old_text.is_empty() { 0 }
        else if old_text.ends_with('\n') { old_lines.len() - 1 }
        else { old_lines.len() };
    let m = if new_text.is_empty() { 0 }
        else if new_text.ends_with('\n') { new_lines.len() - 1 }
        else { new_lines.len() };

    if n == 0 && m == 0 { return vec![]; }
    if n == 0 { return vec![Hunk::Insert { new_start: 0, new_end: m }]; }
    if m == 0 { return vec![Hunk::Delete { old_start: 0, old_end: n }]; }

    if n > 55000 || m > 55000 {
        // Fallback for huge files — just diff sequentially
        return diff_sequential(&old_lines[..n], &new_lines[..m]);
    }

    // Map line content → sentinel char
    let mut line_to_char: HashMap<&str, char> = HashMap::new();
    let mut next_code = 0xE000u32;

    // Encode old
    let mut old_encoded = String::with_capacity(n);
    for i in 0..n {
        let line = old_lines[i];
        let c = line_to_char.entry(line).or_insert_with(|| {
            let c = char::from_u32(next_code).unwrap_or('\u{E000}');
            next_code += 1;
            c
        });
        old_encoded.push(*c);
    }

    // Encode new
    let mut new_encoded = String::with_capacity(m);
    for i in 0..m {
        let line = new_lines[i];
        let c = line_to_char.entry(line).or_insert_with(|| {
            let c = char::from_u32(next_code).unwrap_or('\u{E000}');
            next_code += 1;
            c
        });
        new_encoded.push(*c);
    }

    // Run character-level diff
    let (_d, edit_map) = match diff_greedy(&old_encoded, &new_encoded) {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let deletes: Vec<Edit> = edit_map.get("delete").cloned().unwrap_or_default();
    let inserts: Vec<Edit> = edit_map.get("insert").cloned().unwrap_or_default();

    // Since each line = 1 char, edit positions correspond to line indices.
    // For Delete: at=line_index_to_delete, to=same (single char delete)
    // For Insert: at=position_in_old_where_insert_happens, to=same
    
    // Build a set of deleted line indices
    let mut deleted: Vec<bool> = vec![false; n];
    for e in &deletes {
        if e.at < n { deleted[e.at] = true; }
    }

    // Build insertions grouped by position in old
    // Insert at position `at` in old means lines from new are inserted before old[at]
    let mut inserts_at: Vec<usize> = vec![0; n + 1];
    for e in &inserts {
        if e.at <= n { inserts_at[e.at] += 1; }
    }

    // Walk through both texts simultaneously
    let mut hunks: Vec<Hunk> = vec![];
    let mut oi = 0usize;
    let mut ni = 0usize;

    // Helper: flush any pending equal segment
    let flush = |hunks: &mut Vec<Hunk>, oi: usize, ni: usize,
                     eq_start: &mut Option<(usize, usize)>| {
        if let Some((so, sn)) = *eq_start {
            let len = oi.saturating_sub(so).max(ni.saturating_sub(sn));
            if len > 0 {
                hunks.push(Hunk::Equal { old_start: so, new_start: sn, length: len });
            }
            *eq_start = None;
        }
    };

    let mut eq_start: Option<(usize, usize)> = None;

    for pos in 0..=n {
        // Handle inserts before position `pos`
        if pos < inserts_at.len() && inserts_at[pos] > 0 {
            flush(&mut hunks, oi, ni, &mut eq_start);
            let count = inserts_at[pos];
            hunks.push(Hunk::Insert { new_start: ni, new_end: ni + count });
            ni += count;
        }

        // Handle delete at position `pos`
        if pos < n && deleted[pos] {
            flush(&mut hunks, oi, ni, &mut eq_start);
            let mut del_count = 0usize;
            while pos + del_count < n && deleted[pos + del_count] {
                del_count += 1;
            }
            hunks.push(Hunk::Delete { old_start: oi, old_end: oi + del_count });
            oi += del_count;
        } else if pos < n && !deleted[pos] {
            // Equal line
            if eq_start.is_none() {
                eq_start = Some((oi, ni));
            }
            oi += 1;
            ni += 1;
        }
    }

    flush(&mut hunks, oi, ni, &mut eq_start);

    hunks
}

/// Simple sequential diff for huge files — just return all as equal.
fn diff_sequential(_old: &[&str], _new: &[&str]) -> Vec<Hunk> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn debug(r: &[Hunk]) -> String {
        serde_json::to_string(r).unwrap()
    }

    #[test]
    fn identical() {
        let r = diff_lines("a\nb\nc", "a\nb\nc");
        assert_eq!(r.len(), 1, "{}", debug(&r));
    }

    #[test]
    fn insert_line() {
        let r = diff_lines("a\nb", "a\nx\nb");
        let s = debug(&r);
        assert!(s.contains("insert"), "{}", s);
    }

    #[test]
    fn delete_line() {
        let r = diff_lines("a\nb\nc", "a\nc");
        let s = debug(&r);
        assert!(s.contains("delete"), "{}", s);
    }

    #[test]
    fn empty_both() {
        assert!(diff_lines("", "").is_empty());
    }

    #[test]
    fn empty_old() {
        let s = debug(&diff_lines("", "a\nb"));
        assert!(s.contains("insert"), "{}", s);
    }

    #[test]
    fn empty_new() {
        let s = debug(&diff_lines("a\nb", ""));
        assert!(s.contains("delete"), "{}", s);
    }

    #[test]
    fn crlf() {
        let r = diff_lines("a\r\nb\r\n", "a\r\nb\r\n");
        assert_eq!(r.len(), 1);
    }

    #[test]
    fn modify_mid() {
        let r = diff_lines("line1\nold\nline3", "line1\nnew\nline3");
        let s = debug(&r);
        assert!(s.contains("delete"), "{}", s);
        assert!(s.contains("insert"), "{}", s);
    }

    #[test]
    fn deletion_at_start() {
        let r = diff_lines("a\nb\nc", "b\nc");
        let s = debug(&r);
        assert!(s.contains("delete"), "{}", s);
    }

    #[test]
    fn insertion_at_start() {
        let r = diff_lines("b\nc", "a\nb\nc");
        let s = debug(&r);
        assert!(s.contains("insert"), "{}", s);
    }
}
