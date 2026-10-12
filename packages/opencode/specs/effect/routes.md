# Route handler effectification

Practical reference for converting server route handlers in `packages/opencode` to a single `AppRuntime.runPromise(Effect.gen(...))` body.

## Goal

Route handlers should wrap their entire body in a single `AppRuntime.runPromise(Effect.gen(...))` call, yielding services from context rather than calling facades one-by-one.

This eliminates multiple `runPromise` round-trips and lets handlers compose naturally.

```ts
// Before - one facade call per service
;async (c) => {
  await SessionRunState.assertNotBusy(id)
  await Session.removeMessage({ sessionID: id, messageID })
  return c.json(true)
}

// After - one Effect.gen, yield services from context
;async (c) => {
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const state = yield* SessionRunState.Service
      const session = yield* Session.Service
      yield* state.assertNotBusy(id)
      yield* session.removeMessage({ sessionID: id, messageID })
    }),
  )
  return c.json(true)
}
```

## Rules

- Wrap the whole handler body in one `AppRuntime.runPromise(Effect.gen(...))` call when the handler is service-heavy.
- Yield services from context instead of calling async facades repeatedly.
- When independent service calls can run in parallel, use `Effect.all(..., { concurrency: "unbounded" })`.
- Prefer one composed Effect body over multiple separate `runPromise(...)` calls in the same handler.

## Current route files

Current instance route files live under `src/server/routes/instance`. Which ones still use the old shape is state, so read it from the tree rather than from a list here (the 2026-10-03 lists ranked files by how far along they were, and the code has moved since):

```sh
rg -nF -e "Instance." -e "runRequest(" -e "Bus.publish" src/server/routes/instance
```

A file with no hits there is already on the intended service-yielding shape.

## Notes

- Route conversion is now less about facade removal and more about removing the remaining direct `Instance.*` reads, `Instance.provide(...)` boundaries, and small Promise-style bridges inside route files.
- `jsonRequest(...)` / `runRequest(...)` already provide a good intermediate shape for many handlers. The remaining cleanup is mostly consistency work in the heavier files.
