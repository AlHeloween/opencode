---
description: "Bump AI SDK dependencies — minor/patch only"
---

Audit AI SDK dependencies in package.json and packages/opencode/package.json for available minor/patch upgrades.

## Rules
- Report only — do NOT upgrade. Include changelog links.
- No major version upgrades.
- Scan both root package.json and packages/opencode/package.json.

## Output
List each dependency with: current version → latest compatible version, changelog URL, breaking changes (if any in minor).
