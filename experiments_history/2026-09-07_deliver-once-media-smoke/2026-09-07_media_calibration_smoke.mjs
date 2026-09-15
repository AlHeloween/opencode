// Smoke (2026-09-07): media token calibration — record + estimate + estimateContentTokens media exclusion.
import { Database } from "../../packages/opencode/src/storage/db.ts"
import { MediaTokenCalibration } from "../../packages/opencode/src/session/media-token-calibration.ts"
import { estimateContentTokens, estimateMediaTokens } from "../../packages/opencode/src/session/overflow.ts"

// Minimal model stub — video+image capable.
const model = {
  providerID: "zai-org",
  id: "glm-5.3-flash-test",
  capabilities: { input: { video: true, image: true } },
} as any

// Initialize DB (project data dir) — Database.use needs project context.
const { Global } = await import("../../packages/opencode/src/global/index.ts")
Global.Path.init(process.cwd())

// 1. Record: provider says 2610 video tokens for 1 clip.
MediaTokenCalibration.record({ model, modality: "video", measuredTokens: 2610, itemCount: 1 })
const est1 = MediaTokenCalibration.estimate({ model, modality: "video", count: 1 })
console.log("after 1 obs: estimate(1 video) =", est1, "(expect 2610)")

// 2. Second observation EMA: 70% old + 30% new.
MediaTokenCalibration.record({ model, modality: "video", measuredTokens: 3000, itemCount: 1 })
const est2 = MediaTokenCalibration.estimate({ model, modality: "video", count: 1 })
const expected = Math.round(2610 * 0.7 + 3000 * 0.3)
console.log("after 2 obs: estimate =", est2, "(expect", expected + ")")

// 3. Two clips: 2 × per-item.
const est3 = MediaTokenCalibration.estimate({ model, modality: "video", count: 2 })
console.log("estimate(2 videos) =", est3, "(expect", expected * 2 + ")")

// 4. Modality gate: unsupported model gets 0.
const noVideo = { ...model, capabilities: { input: { image: true } } } as any
const est4 = MediaTokenCalibration.estimate({ model: noVideo, modality: "video", count: 1 })
console.log("unsupported video estimate =", est4, "(expect 0)")

// 5. estimateContentTokens: tool output with a giant data URL attachment counts TEXT ONLY.
const msgs = [
  {
    info: { id: "m1", role: "assistant" },
    parts: [
      {
        type: "tool",
        id: "p1",
        messageID: "m1",
        sessionID: "s1",
        tool: "read",
        callID: "c1",
        state: {
          status: "completed",
          input: {},
          output: "Video read successfully",
          title: "read",
          metadata: {},
          time: { start: 0, end: 1 },
          attachments: [{ type: "file", mime: "video/mp4", url: "data:video/mp4;base64," + "A".repeat(2_750_000) }],
        },
      },
    ],
  },
] as any
const textTokens = estimateContentTokens(msgs, model)
console.log("tool output with 2.75M blob -> text tokens =", textTokens, "(expect ~10, was ~688k)")

// 6. estimateMediaTokens over history with the delivered user file-part.
const withMedia = [
  ...msgs,
  {
    info: { id: "m2", role: "user" },
    parts: [{ type: "file", id: "p2", messageID: "m2", sessionID: "s1", mime: "video/mp4", url: "data:video/mp4;base64,AAAA" }],
  },
] as any
const mediaTokens = estimateMediaTokens(withMedia, model)
console.log("estimateMediaTokens(1 clip in history) =", mediaTokens, "(expect", expected + ")")
