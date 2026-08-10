---
description: "Remove AI-generated code slop from the diff"
---

Review the diff against the dev branch and remove AI-generated code slop.

## What to remove
- Redundant or excessive comments
- Defensive null checks that are unnecessary
- `as any` type casts that can be properly typed
- Inconsistent style from the project conventions
- Unnecessary emoji or decorative text

## What to preserve
- Actual logic and functionality
- Intentional type workarounds (with existing comments explaining why)
- Project-consistent style
