import fs from "fs/promises"
import path from "path"
import { Glob } from "@opencode-ai/core/util/glob"
import * as Log from "@opencode-ai/core/util/log"

const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024
const MAX_ROTATED_FILES = 10

export class LogRotator {
  private logDir: string
  private baseName: string
  private currentSize: number = 0
  private lastCheckTime: number = 0

  constructor(logDir: string, baseName: string = "gateway") {
    this.logDir = logDir
    this.baseName = baseName
  }

  async init(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true })
    const logFile = path.join(this.logDir, `${this.baseName}.log`)
    try {
      const stat = await fs.stat(logFile)
      this.currentSize = stat.size
    } catch {
      this.currentSize = 0
    }
  }

  async addBytes(bytes: number): Promise<void> {
    this.currentSize += bytes
    await this.checkRotation()
  }

  async checkRotation(): Promise<void> {
    const now = Date.now()
    if (now - this.lastCheckTime < 1000) return
    this.lastCheckTime = now

    if (this.currentSize >= MAX_LOG_SIZE_BYTES) {
      await this.rotate()
    }
  }

  private async rotate(): Promise<void> {
    const timestamp = this.getTimestamp()
    const logFile = path.join(this.logDir, `${this.baseName}.log`)
    const rotatedFile = path.join(this.logDir, `${timestamp}-${this.baseName}.log`)

    try {
      await fs.rename(logFile, rotatedFile)
      this.currentSize = 0
    } catch {
      return
    }

    await this.cleanup()
  }

  private getTimestamp(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    const hours = String(now.getHours()).padStart(2, "0")
    const minutes = String(now.getMinutes()).padStart(2, "0")
    const seconds = String(now.getSeconds()).padStart(2, "0")
    const ms = String(now.getMilliseconds()).padStart(3, "0")
    return `${year}-${month}-${day}T${hours}${minutes}${seconds}.${ms}`
  }

  private async cleanup(): Promise<void> {
    const pattern = `*-(${this.baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}).log`
    const files = await Glob.scan(pattern, {
      cwd: this.logDir,
      absolute: true,
      include: "file",
    })

    if (files.length <= MAX_ROTATED_FILES) return

    const sorted = files.sort()
    const toDelete = sorted.slice(0, sorted.length - MAX_ROTATED_FILES)
    await Promise.all(toDelete.map((file) => fs.unlink(file).catch((e) => { Log.Default.debug("failed to unlink rotated log file", { file, error: String(e) }) })))
  }
}
