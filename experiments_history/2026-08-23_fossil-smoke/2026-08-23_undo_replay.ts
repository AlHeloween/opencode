/**
 * 2026-08-23 undo replay analyzer (dry-run, read-only).
 *
 * Replicates session/revert.ts targeting against a REAL session from the
 * project DB and reports consistency problems that make undo-to-message
 * behave "broken":
 *   - steps after the target message with NO patch part (their writes are
 *     not in any leaf -> undo silently leaves them on disk)
 *   - patch parts with empty files[] / duplicate hashes
 *   - target hash resolution (what revertTo would receive)
 *
 * Usage: bun experiments/2026-08-23_fossil-smoke/2026-08-23_undo_replay.ts <sessionID> [messageID]
 * Read-only: opens the DB with readonly:true, never touches fossil.
 */
import { Database } from "bun:sqlite"

const sessionID = process.argv[2]
const targetMessageID = process.argv[3]
if (!sessionID) {
    console.error("usage: bun experiments/2026-08-23_fossil-smoke/2026-08-23_undo_replay.ts <sessionID> [messageID]")
    process.exit(1)
}

const db = new Database(".opencode/data/opencode.db", { readonly: true })

interface PartRow { id: string; message_id: string; type: string; data: string }
interface MsgRow { id: string; data: string; time_created: number }

const messages = db
    .query(`SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created, id`)
    .all(sessionID) as MsgRow[]
if (messages.length === 0) {
    console.error(`no messages for ${sessionID}`)
    process.exit(1)
}

const partsByMsg = new Map<string, PartRow[]>()
for (const p of db
    .query(`SELECT id, message_id, type, data FROM part WHERE session_id = ? ORDER BY time_created, id`)
    .all(sessionID) as PartRow[]) {
    const list = partsByMsg.get(p.message_id) ?? []
    list.push(p)
    partsByMsg.set(p.message_id, list)
}

const roleOf = (id: string): string => {
    try {
        return (JSON.parse(messages.find((m) => m.id === id)!.data) as { role?: string }).role ?? "?"
    } catch {
        return "?"
    }
}

console.log(`session ${sessionID}: ${messages.length} messages`)
const userMsgs = messages.filter((m) => roleOf(m.id) === "user")
console.log(`user messages (undo candidates): ${userMsgs.length}`)

// Replicate revert.ts collection loop for one target.
function collectPatches(messageID: string) {
    let rev: { messageID: string } | undefined
    const patches: { hash: string; files: string[]; partID: string; messageID: string }[] = []
    let lastUser: string | undefined
    for (const msg of messages) {
        if (roleOf(msg.id) === "user") lastUser = msg.id
        const parts = partsByMsg.get(msg.id) ?? []
        let remaining: string[] = []
        for (const part of parts) {
            if (rev) {
                if (part.type === "patch") {
                    const d = JSON.parse(part.data) as { hash?: string; files?: string[] }
                    patches.push({ hash: d.hash ?? "", files: d.files ?? [], partID: part.id, messageID: msg.id })
                }
                continue
            }
            if (msg.id === messageID) {
                rev = { messageID: lastUser ?? msg.id }
            }
            remaining.push(part.id)
        }
    }
    return { rev, patches }
}

// Step integrity: every assistant step between two user messages should carry a patch part.
function stepGaps(): { gapAfter: string; missing: number }[] {
    const gaps: { gapAfter: string; missing: number }[] = []
    for (let i = 0; i < messages.length; i++) {
        if (roleOf(messages[i]!.id) !== "assistant") continue
        const parts = partsByMsg.get(messages[i]!.id) ?? []
        const hasTool = parts.some((p) => p.type === "tool")
        const hasPatch = parts.some((p) => p.type === "patch")
        if (hasTool && !hasPatch) {
            const nextUser = messages.slice(i + 1).find((m) => roleOf(m.id) === "user")
            gaps.push({ gapAfter: nextUser?.id ?? "(tail)", missing: gaps.length + 1 })
        }
    }
    return gaps
}

const gaps = stepGaps()
console.log(`\nassistant steps with tool writes but NO patch part (undo blind spots): ${gaps.length}`)
for (const g of gaps.slice(0, 10)) console.log(`  next-user=${g.gapAfter}`)

if (targetMessageID) {
    const { rev, patches } = collectPatches(targetMessageID)
    console.log(`\nrevert(target=${targetMessageID}):`)
    console.log(`  rev.messageID = ${rev?.messageID ?? "(no rev — target not found)"}`)
    console.log(`  targetHash    = ${patches[0]?.hash ?? "(none — read-only tail, message cleanup only)"}`)
    console.log(`  undone steps  = ${patches.length}`)
    const seen = new Set<string>()
    for (const p of patches) {
        const dup = seen.has(p.hash) ? " DUP" : ""
        seen.add(p.hash)
        console.log(`   - ${p.hash.slice(0, 12)} files=${p.files.length}${dup} (msg=${p.messageID})`)
        if (p.files.length === 0) console.log(`     !! empty files[]`)
    }
} else {
    console.log(`\n(dry-run listing only; pass messageID for per-target analysis)`)
    console.log(`newest user candidates:`)
    for (const m of userMsgs.slice(-5)) console.log(`  ${m.id}`)
}
