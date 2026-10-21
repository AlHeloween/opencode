# fixture — the oracle is INLINE and the store holds NO manifest for it

<!-- intention: fixture -> fixture -->

## Tasks

- [ ] **S2** — write the golden file for `docs/x.md` from the current output. Oracle: the regenerated file is byte-identical (`cmp` exit 0).

## Smoke Tests

- `cmp` exit 0 between the golden file and the regenerated one.
