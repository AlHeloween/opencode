use std::io::Cursor;
use wasm_bindgen::prelude::*;

fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    let doc =
        lopdf::Document::load_mem(bytes).map_err(|e| format!("Failed to load PDF: {:?}", e))?;

    let pages = doc.get_pages();
    if pages.is_empty() {
        return Ok(String::new());
    }

    let page_nums: Vec<u32> = pages.keys().cloned().collect();
    doc.extract_text(&page_nums)
        .map_err(|e| format!("Failed to extract text: {:?}", e))
}

#[wasm_bindgen]
pub fn convert_to_markdown(bytes: &[u8], filename: String) -> Result<String, JsValue> {
    let lower = filename.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");

    match ext {
        "pdf" => extract_pdf_text(bytes)
            .map_err(|e| JsValue::from_str(&format!("Failed to extract text from PDF: {}", e))),

        "rss" | "atom" => {
            let feed = feed_rs::parser::parse(Cursor::new(bytes))
                .map_err(|e| JsValue::from_str(&format!("Failed to parse feed: {}", e)))?;

            let mut markdown = String::new();
            if let Some(title) = &feed.title {
                markdown.push_str(&format!("# {}\n\n", title.content));
            }

            for entry in &feed.entries {
                if let Some(title) = &entry.title {
                    markdown.push_str(&format!("## {}\n\n", title.content));
                }
                if let Some(summary) = &entry.summary {
                    markdown.push_str(&html2md::parse_html(&summary.content));
                    markdown.push_str("\n\n");
                }
                if let Some(content) = &entry.content {
                    if let Some(body) = &content.body {
                        markdown.push_str(&html2md::parse_html(body));
                        markdown.push_str("\n\n");
                    }
                }
                if let Some(updated) = &entry.updated {
                    markdown.push_str(&format!("_Updated: {}_\n\n", updated));
                }
            }
            Ok(markdown)
        }

        "jpg" | "jpeg" => {
            let mut file = Cursor::new(bytes);
            let reader = exif::Reader::new();
            let exif = reader.read_from_container(&mut file)
                .map_err(|e| JsValue::from_str(&format!("Failed to read EXIF data: {}", e)))?;

            let mut markdown = String::new();
            markdown.push_str("# Image Metadata\n\n");
            for field in exif.fields() {
                markdown.push_str(&format!(
                    "**{}**: {}\n",
                    field.tag,
                    field.display_value().with_unit(&exif)
                ));
            }
            Ok(markdown)
        }

        "png" | "gif" | "bmp" | "tiff" | "tif" | "webp" | "svg" => {
            Ok(format!("# Image\n\n![{}]({})", filename, filename))
        }

        "mp3" | "wav" | "ogg" | "m4a" | "aac" | "flac" | "weba" => {
            Ok(format!("# Audio\n\nAudio file: `{}`\n\n<!-- Audio transcription not available in WASM mode -->", filename))
        }

        "mp4" | "mov" | "avi" | "wmv" | "flv" | "webm" | "mkv" | "m4v" | "mpg" | "mpeg" => {
            Ok(format!("# Video\n\nVideo file: `{}`\n\n<!-- Video transcription not available in WASM mode -->", filename))
        }

        _ => {
            let mut input = markdownify::MarkdownifyInput::from_bytes(bytes, filename)
                .map_err(|e| JsValue::from_str(&format!("Failed to parse file: {}", e)))?;

            if let Some(ext) = input.id.rsplit('.').next() {
                input.set_ext(ext.to_lowercase());
            }

            input
                .convert()
                .map_err(|e| JsValue::from_str(&format!("Failed to convert to markdown: {}", e)))
        }
    }
}

#[wasm_bindgen]
pub fn supported_extensions() -> Vec<String> {
    vec![
        "pdf".into(),
        "docx".into(),
        "xlsx".into(),
        "xlsm".into(),
        "xlsb".into(),
        "pptx".into(),
        "pptm".into(),
        "csv".into(),
        "ods".into(),
        "odt".into(),
        "odp".into(),
        "html".into(),
        "htm".into(),
        "xml".into(),
        "json".into(),
        "txt".into(),
        "md".into(),
        "rss".into(),
        "atom".into(),
        "jpg".into(),
        "jpeg".into(),
        "png".into(),
        "gif".into(),
        "bmp".into(),
        "tiff".into(),
        "tif".into(),
        "webp".into(),
        "svg".into(),
        "mp3".into(),
        "wav".into(),
        "ogg".into(),
        "m4a".into(),
        "aac".into(),
        "flac".into(),
        "weba".into(),
        "mp4".into(),
        "mov".into(),
        "avi".into(),
        "wmv".into(),
        "flv".into(),
        "webm".into(),
        "mkv".into(),
        "m4v".into(),
        "mpg".into(),
        "mpeg".into(),
        "zip".into(),
        "tar".into(),
        "gz".into(),
        "7z".into(),
    ]
}

#[wasm_bindgen]
pub fn is_supported_extension(ext: &str) -> bool {
    let ext_lower = ext.to_lowercase();
    matches!(
        ext_lower.as_str(),
        "pdf"
            | "docx"
            | "xlsx"
            | "xlsm"
            | "xlsb"
            | "pptx"
            | "pptm"
            | "csv"
            | "ods"
            | "odt"
            | "odp"
            | "html"
            | "htm"
            | "xml"
            | "json"
            | "txt"
            | "md"
            | "rss"
            | "atom"
            | "jpg"
            | "jpeg"
            | "png"
            | "gif"
            | "bmp"
            | "tiff"
            | "tif"
            | "webp"
            | "svg"
            | "mp3"
            | "wav"
            | "ogg"
            | "m4a"
            | "aac"
            | "flac"
            | "weba"
            | "mp4"
            | "mov"
            | "avi"
            | "wmv"
            | "flv"
            | "webm"
            | "mkv"
            | "m4v"
            | "mpg"
            | "mpeg"
            | "zip"
            | "tar"
            | "gz"
            | "7z"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_extensions_includes_pdf() {
        assert!(is_supported_extension("pdf"));
        assert!(is_supported_extension("PDF"));
        assert!(is_supported_extension("Pdf"));
    }

    #[test]
    fn test_supported_extensions_list() {
        let exts = supported_extensions();
        assert!(exts.contains(&"pdf".to_string()));
        assert!(exts.contains(&"docx".to_string()));
        assert!(exts.contains(&"xlsx".to_string()));
        assert!(exts.contains(&"pptx".to_string()));
    }

    #[test]
    fn test_unsupported_extension() {
        assert!(!is_supported_extension("exe"));
        assert!(!is_supported_extension("dll"));
    }
}
