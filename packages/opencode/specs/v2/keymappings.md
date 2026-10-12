# Keybindings vs. Keymappings

> **Not an inventory.** A design note: it proposes reshaping keybindings into `keymappings`, and does
> not describe the system as it is. Nothing here is recomputed by a command, so nothing here can rot;
> treat its status as Unknown until someone checks the code.

Make it `keymappings`, closer to neovim. Can be layered like `<leader>abc`. Commands don't define their binding, but have an id that a key can be mapped to like

```ts
{ key: "ctrl+w", cmd: string | function, description }
```

_Why_
Currently its keybindings that have an `id` like `message_redo` and then a command can use that or define it's own binding. While some keybindings are just used with `.match` in arbitrary key handlers and there is no info what the key is used for, except the binding id maybe. It also is unknown in which context/scope what binding is active, so a plugin like `which-key` is nearly impossible to get right.
