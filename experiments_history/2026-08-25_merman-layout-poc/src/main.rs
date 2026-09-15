use merman::render::{HeadlessRenderer, HostThemeProfile};
use std::{fs, io};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let source = fs::read_to_string("fixtures/feedback-flowchart.mmd")?;
    let profile = HostThemeProfile::editor_dark();
    let svg = HeadlessRenderer::new()
        .with_diagram_id("feedback-flowchart")
        .with_host_theme(&profile)
        .render_svg_resvg_safe_sync(&source)?
        .ok_or_else(|| io::Error::other("merman did not detect a Mermaid diagram"))?;

    fs::create_dir_all("output")?;
    fs::write("output/merman-resvg-safe.svg", svg)?;
    Ok(())
}
