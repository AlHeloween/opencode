type Level = "DEBUG" | "INFO" | "WARN" | "ERROR"

interface Logger {
  debug: (message: string, extra?: Record<string, unknown>) => void
  info: (message: string, extra?: Record<string, unknown>) => void
  warn: (message: string, extra?: Record<string, unknown>) => void
  error: (message: string, extra?: Record<string, unknown>) => void
  tag: (tags: Record<string, string>) => Logger
  clone: () => Logger
  time: (label: string) => { stop: () => void; [Symbol.dispose]: () => void }
}

const isElectron = typeof window !== "undefined" && "api" in window

function send(level: string, message: string, extra?: Record<string, unknown>) {
  if (isElectron && (window as any).api?.log) {
    (window as any).api.log(level as "debug" | "info" | "warn" | "error", message, extra)
    return
  }
  const fn = level === "warn" ? console.warn
    : level === "error" ? console.error
    : level === "info" ? console.info
    : console.debug
  fn(message, extra ?? "")
}

const browserLogger: Logger = {
  debug: (message, extra) => send("debug", message, extra as Record<string, unknown> | undefined),
  info: (message, extra) => send("info", message, extra as Record<string, unknown> | undefined),
  warn: (message, extra) => send("warn", message, extra as Record<string, unknown> | undefined),
  error: (message, extra) => send("error", message, extra as Record<string, unknown> | undefined),
  tag: () => browserLogger,
  clone: () => browserLogger,
  time: () => ({ stop() {}, [Symbol.dispose]() {} }),
}

export type { Level, Logger }
export interface Options { print?: boolean }
export const Default = browserLogger
export function create(): Logger { return browserLogger }
export async function init(_options?: Options): Promise<void> {}
export async function reopen(): Promise<void> {}
export function bugReport(): unknown[] { return [] }
export function file(): string { return "" }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const _Level: any = undefined
