import path from "path"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"

let _worktree = ""

const app = "opencode"

const exeDir = path.dirname(process.execPath)

let _data = path.join(exeDir, ".opencode", "data")
let _cache = path.join(exeDir, ".opencode", "data", "cache")
let _state = path.join(exeDir, ".opencode", "data", "state")
let _log = path.join(exeDir, ".opencode", "data", "log")
let _bin = path.join(exeDir, ".opencode", "data", "cache", "bin")
const _config = exeDir

export function initFromWorktree(worktree: string) {
  _worktree = worktree
  _data = path.join(worktree, ".opencode", "data")
  _cache = path.join(worktree, ".opencode", "data", "cache")
  _state = path.join(worktree, ".opencode", "data", "state")
  _log = path.join(worktree, ".opencode", "data", "log")
  _bin = path.join(worktree, ".opencode", "data", "cache", "bin")
}

const paths = {
  get home() {
    return process.env.OPENCODE_TEST_HOME ?? _worktree
  },
  get data() {
    return _data
  },
  get bin() {
    return _bin
  },
  get log() {
    return _log
  },
  get cache() {
    return _cache
  },
  get config() {
    return _config
  },
  get state() {
    return _state
  },
  get worktree() {
    return _worktree
  },
}

export const Path = paths

Flock.setGlobal({ state: paths.config })

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly bin: string
  readonly log: string
  readonly worktree: string
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      home: Path.home,
      data: Path.data,
      cache: Path.cache,
      config: Path.config,
      state: Path.state,
      bin: Path.bin,
      log: Path.log,
      worktree: Path.worktree,
    })
  }),
)

export * as Global from "./global"
