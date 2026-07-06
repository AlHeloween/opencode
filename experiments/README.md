# Experiments

Ad-hoc test scripts and explorative code organized by topic.

## Structure

| Directory | Purpose |
|-----------|---------|
| `mermaid/` | Mermaid diagram rendering tests (WASM, chafa, ANSI output) |
| `vision/` | Image/vision support tests (dragon test images, vision model testing) |
| `tui_rendering/` | TUI rendering experiments |
| `*_smoke_test/` | API smoke tests for various providers |
| `*_tests/` | Grounding and other functional tests |
| Root `.ts`/`.py` files | Miscellaneous benchmarks and utilities |

## Notes

- These are NOT production tests — they are manual exploration scripts.
- No dependencies are guaranteed; some scripts may require specific API keys or packages.
- Files here are git-tracked for reproducibility but not part of the test suite.
