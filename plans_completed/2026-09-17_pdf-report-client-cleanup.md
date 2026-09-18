# Software Maturity Engine PDF client cleanup

state: COMPLETE

<!-- intention: existing commercial report contains export artifacts and clipped content -> separate client-ready PDF preserves all analysis while removing confirmed presentation defects -->

## Scope

- Preserve the source PDF unchanged.
- Produce one cleaned PDF under `output/pdf/`.
- Remove the three visible internal `filecite/turn0file0` markers on pages 1, 9, and 10.
- Remove the dead `Download the ... chart` export prompts on pages 14 and 15.
- Replace the clipped maturity-cycle line on page 16 with a fully visible ASCII rendering.
- Do not change analytical claims, pricing, calculations, sources, or page order.
- The supplied `D:\zPascal\XEComponents\.opencode\data` endurance benchmark is acknowledged but is not added to this presentation-only edit.

## Risks

- R1: visual masking leaves searchable artifact text. Containment: use true PDF redaction and verify extracted text.
- R2: the page-16 replacement overlaps body text. Containment: bind it to the original line rectangle and render the page.
- R3: PDF rewrite drops pages or metadata. Containment: compare page count, metadata, and source/output readability.

## Smoke Tests

### Baseline

- Source has 19 pages.
- Extracted text contains `filecite`, `turn0file0`, and both dead download prompts.
- Page 16 content extends beyond the 612-point media box.

### Post-change oracle

- Source SHA-256 is unchanged.
- Output has 19 readable pages and preserves the report title.
- Extracted output text contains none of `filecite`, `turn0file0`, or the two dead download prompts.
- Page 16 contains the full replacement cycle line within the media box.
- Render every output page to PNG; visually inspect all pages, with original-resolution inspection of pages 1, 9, 10, 14, 15, and 16.

## Rollback

Delete only the new output PDF; the source PDF remains untouched.

## Oracle Result

- PASS: output reopens as a 19-page Letter PDF with original title metadata.
- PASS: extracted text contains no `filecite`, `turn0file0`, or dead download prompts.
- PASS: no extracted glyph extends beyond any page media box.
- PASS: page 14 financial outcomes are fully visible in two compact tables with all original values.
- PASS: page 16 maturity cycle is fully visible and searchable.
- PASS: all 19 pages rendered; full contact-sheet review plus original-resolution review of changed pages found no clipping, overlap, black squares, or unreadable text.
- Source SHA-256 remained `F5B4C73449387C1D4BBE12B1B80F822281183EDE6457A3F919B92BADEFA40069`.
- Output SHA-256: `E04BDA2CECB97B43199C9E9425D26DDC458CE29F3D2A1FD839E6B0C5B62D1EA8`.
