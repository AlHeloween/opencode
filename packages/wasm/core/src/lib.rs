use wasm_bindgen::prelude::*;
use tree_sitter::Parser;
use serde_json::json;

/// Entry for a registered tree-sitter language.
struct LangEntry {
    name: &'static str,
    language: tree_sitter::Language,
}

/// Statically initialized language entries.
/// Uses OnceLock for thread-safe lazy initialization — the module lives
/// for the entire WASM application lifetime.
fn get_languages() -> &'static [LangEntry] {
    use std::sync::OnceLock;
    static LANGS: OnceLock<Box<[LangEntry]>> = OnceLock::new();
    LANGS.get_or_init(|| {
        Box::new([
            LangEntry {
                name: "bash",
                language: tree_sitter_bash::LANGUAGE.into(),
            },
            LangEntry {
                name: "powershell",
                language: tree_sitter_powershell::LANGUAGE.into(),
            },
            LangEntry {
                name: "python",
                language: tree_sitter_python::LANGUAGE.into(),
            },
            LangEntry {
                name: "rust",
                language: tree_sitter_rust::LANGUAGE.into(),
            },
            LangEntry {
                name: "go",
                language: tree_sitter_go::LANGUAGE.into(),
            },
            LangEntry {
                name: "cpp",
                language: tree_sitter_cpp::LANGUAGE.into(),
            },
            LangEntry {
                name: "json",
                language: tree_sitter_json::LANGUAGE.into(),
            },
            LangEntry {
                name: "yaml",
                language: tree_sitter_yaml::LANGUAGE.into(),
            },
        ])
    })
}

/// Recursively convert a tree-sitter node to a JSON value matching
/// web-tree-sitter's node.toJSON() format:
/// {
///   type: string,
///   startPosition: { row: number, column: number },
///   endPosition: { row: number, column: number },
///   startIndex: number,
///   endIndex: number,
///   children: array,
///   fieldName?: string
/// }
fn node_to_json(node: &tree_sitter::Node, source: &str) -> serde_json::Value {
    let mut children = Vec::new();
    let mut cursor = node.walk();
    for (i, child) in node.children(&mut cursor).enumerate() {
        let child_json = node_to_json(&child, source);

        // In tree-sitter 0.24, field_name is retrieved via field_name_for_child(index)
        if let Some(obj) = child_json.as_object() {
            let mut obj = obj.clone();
            if let Some(field_name) = node.field_name_for_child(i as u32) {
                obj.insert("fieldName".to_string(), json!(field_name));
            }
            children.push(json!(obj));
        } else {
            children.push(child_json);
        }
    }

    let pos = node.start_position();
    let end_pos = node.end_position();

    json!({
        "type": node.kind(),
        "startPosition": {
            "row": pos.row,
            "column": pos.column,
        },
        "endPosition": {
            "row": end_pos.row,
            "column": end_pos.column,
        },
        "startIndex": node.start_byte(),
        "endIndex": node.end_byte(),
        "children": children,
    })
}

/// Parse code using the specified language and return a JSON AST.
///
/// Returns `None` if the language is not found or parsing fails.
#[wasm_bindgen]
pub fn parse(code: &str, language: &str) -> Option<String> {
    let langs = get_languages();
    let lang = langs.iter().find(|l| l.name == language)?;

    let mut parser = Parser::new();
    parser.set_language(&lang.language).ok()?;
    let tree = parser.parse(code, None)?;
    let root = tree.root_node();

    let ast = node_to_json(&root, code);
    serde_json::to_string(&ast).ok()
}

/// Return an array of all available language names.
#[wasm_bindgen]
pub fn available_languages() -> js_sys::Array {
    let langs = get_languages();
    let arr = js_sys::Array::new();
    for l in langs {
        arr.push(&JsValue::from_str(l.name));
    }
    arr
}
