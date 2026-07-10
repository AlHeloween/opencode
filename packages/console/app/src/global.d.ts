import "solid-js/web"

declare module "solid-js/web" {
  interface RequestEvent {
    locals: Record<string | number | symbol, any>
  }
}

// @solidjs/start@2.0.0-devinxi.0 dist/server/index.d.ts doesn't
// re-export APIEvent/APIHandler from types.js — add them here.
declare module "@solidjs/start/server" {
  export type { APIEvent, APIHandler } from "@solidjs/start/dist/server/types.js"
}
