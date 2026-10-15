import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http2 from 'node:http2'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = 'D:/zPython/opencode'
const here = path.dirname(fileURLToPath(import.meta.url))
const supplement = process.argv.includes('--supplement')
const data = root + '/.opencode/data'
const requestId = 'bf0dd5ff-9ab4-4a09-a7ef-54243b2bc360'
const capturePath = data + '/gateway/raw-wire/2026-10-15T16-13-37-290Z-' + requestId + '-attempt2.json'
const wire = JSON.parse(await fs.readFile(capturePath, 'utf8'))
const original = JSON.parse(wire.body)
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const output = { started: new Date().toISOString(), source: { path: capturePath, capture_sha256: hash(await fs.readFile(capturePath)),
  body_sha256: hash(wire.body), body_bytes: Buffer.byteLength(wire.body), model: original.model,
  thinking: original.thinking, output_config: original.output_config, max_tokens: original.max_tokens,
  system_blocks: original.system?.length, messages: original.messages?.length, tools: original.tools?.length,
}, local_controls: {}, metadata: null, count: null, cases: [] }
const resultFile = supplement ? 'live-supplement-results.json' : 'live-results.json'
const persist = async () => fs.writeFile(path.join(here, resultFile), JSON.stringify(output, null, 2) + '\n')

class EventReader {
  decoder = new TextDecoder()
  carry = ''
  events = []
  push(bytes, final = false) {
    this.carry += this.decoder.decode(bytes, { stream: !final })
    const frames = this.carry.split(/\r?\n\r?\n/)
    this.carry = frames.pop()
    for (const frame of frames) {
      const lines = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart())
      if (lines.length) this.events.push(JSON.parse(lines.join('\n')))
    }
  }
  get complete() { return this.events.some(e => e.type === 'message_stop') }
}
const fixture = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"α_OK"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
const bytes = new TextEncoder().encode(fixture)
const check = new EventReader()
for (let i = 0; i < bytes.length; i++) check.push(bytes.slice(i, i + 1))
assert.equal(check.events[0].delta.text, 'α_OK')
assert.equal(check.complete, true)
const incomplete = new EventReader()
incomplete.push(new TextEncoder().encode(fixture.slice(0, fixture.indexOf('event: message_stop'))))
assert.equal(incomplete.complete, false)
output.local_controls = { bytewise_utf8_sse: 'PASS', complete_stream: 'PASS', truncated_stream: 'EXPECTED_FAIL' }

const db = new DatabaseSync(data + '/opencode.db', { readOnly: true })
const messageId = process.argv.find(arg => arg.startsWith('--message-id='))?.slice('--message-id='.length)
const message = messageId ? db.prepare('SELECT id, data FROM message WHERE id=?').get(messageId) : undefined
const parts = (messageId ? db.prepare('SELECT id, type, time_created, time_updated, data FROM part WHERE message_id=?')
  .all(messageId) : []).map(p => {
    const value = JSON.parse(p.data)
    return { id: p.id, type: p.type, created: p.time_created, updated: p.time_updated,
      text_chars: value.text?.length ?? 0, metadata_keys: Object.keys(value.metadata ?? {}) }
  })
db.close()
const responseFiles = (await fs.readdir(data + '/gateway/per-response')).filter(n => n.includes(requestId))
const gatewayLines = (await fs.readFile(data + '/gateway/gateway.log', 'utf8')).split(/\r?\n/)
const historicalEvents = gatewayLines.map((l, i) => ({ l, line: i + 1 })).filter(x => x.l.includes(requestId))
  .map(x => ({ line: x.line, ...JSON.parse(x.l) }))
output.historical = { message: message && { id: message.id, ...JSON.parse(message.data) }, parts,
  response_files: responseFiles, gateway_events: historicalEvents }
await persist()
if (process.argv.includes('--forensic-only')) { console.log(JSON.stringify({ source: output.source, historical: output.historical })); process.exit(0) }

const auth = JSON.parse(await fs.readFile(root + '/bin/auth.json', 'utf8'))
assert.equal(auth.anthropic.type, 'api')
const origin = new URL(wire.url).origin
assert.equal(origin, 'https://api.anthropic.com')
let inferenceCount = 0
const sanitize = s => String(s).replace(/sk-[A-Za-z0-9_-]{10,}/g, '[REDACTED]')

async function request(endpoint, body, label, maxMs = 150000) {
  if (endpoint === '/v1/messages') { inferenceCount++; assert.ok(inferenceCount <= 12); assert.ok(body.max_tokens <= 8192) }
  const start = Date.now()
  const result = { label, endpoint, started: new Date().toISOString(), body_sha256: body ? hash(JSON.stringify(body)) : undefined,
    output_config: body?.output_config, thinking: body?.thinking, max_tokens: body?.max_tokens,
    status: 0, events: {}, timeline: [], delta_types: {}, text_chars: 0, thinking_chars: 0, signature_chars: 0,
    tool_json_chars: 0, bytes: 0, complete: false }
  await new Promise(resolve => {
    const session = http2.connect(origin)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(deadline)
      session.destroy()
      result.elapsed_ms = Date.now() - start
      resolve()
    }
    const deadline = setTimeout(() => { result.error = 'diagnostic_deadline'; finish() }, maxMs)
    session.on('error', e => { result.error = sanitize(e.message); finish() })
    const headers = Object.fromEntries(Object.entries(wire.headers).filter(([k]) => !k.startsWith(':')))
    headers['x-api-key'] = auth.anthropic.key
    headers['x-request-id'] = crypto.randomUUID()
    const req = session.request({ ...headers, ':method': body ? 'POST' : 'GET', ':path': endpoint })
    const reader = new EventReader()
    let eventOffset = 0
    let rawJson = ''
    req.on('response', h => {
      result.status = h[':status']; result.headers_ms = Date.now() - start
      result.request_id = h['request-id']; result.alpn = session.alpnProtocol
      result.alt_svc = h['alt-svc'] ?? null
      result.content_type = h['content-type']
    })
    req.on('data', chunk => {
      result.bytes += chunk.length
      if (!result.first_byte_ms) result.first_byte_ms = Date.now() - start
      if (result.content_type?.includes('text/event-stream')) {
        try { reader.push(chunk) } catch (e) { result.parse_error = sanitize(e.message); finish(); return }
        for (const e of reader.events.slice(eventOffset)) {
          const ms = Date.now() - start
          result.events[e.type] = (result.events[e.type] ?? 0) + 1
          result.timeline.push({ ms, type: e.type, delta_type: e.delta?.type, chars: (e.delta?.text ?? e.delta?.thinking ?? e.delta?.signature ?? e.delta?.partial_json ?? '').length })
          if (e.delta?.type) result.delta_types[e.delta.type] = (result.delta_types[e.delta.type] ?? 0) + 1
          if (e.delta?.text) { result.text_chars += e.delta.text.length; result.first_text_ms ??= ms; result.text_preview = sanitize((result.text_preview ?? '') + e.delta.text).slice(0,240) }
          if (e.delta?.thinking) { result.thinking_chars += e.delta.thinking.length; result.first_thinking_text_ms ??= ms }
          if (e.delta?.signature) result.signature_chars += e.delta.signature.length
          if (e.delta?.partial_json) { result.tool_json_chars += e.delta.partial_json.length; result.first_tool_delta_ms ??= ms }
          if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') result.tool_names = [...(result.tool_names ?? []), e.content_block.name]
          if (e.type === 'message_start') result.initial_usage = e.message?.usage
          if (e.delta?.stop_reason) result.stop_reason = e.delta.stop_reason
          if (e.usage) result.final_usage = e.usage
          if (e.type === 'error') result.provider_error = e.error
          if (e.type === 'message_stop') result.complete = true
        }
        eventOffset = reader.events.length
      } else rawJson += chunk.toString('utf8')
    })
    req.on('error', e => { result.error = sanitize(e.message); finish() })
    req.on('end', () => {
      if (rawJson) { try { result.json = JSON.parse(rawJson) } catch (e) { result.error_body = sanitize(rawJson).slice(0,1000); result.parse_error = e.message } }
      finish()
    })
    req.end(body ? JSON.stringify(body) : undefined)
  })
  console.log(JSON.stringify({ label: result.label, status: result.status, elapsed_ms: result.elapsed_ms,
    complete: result.complete, text_chars: result.text_chars, thinking_chars: result.thinking_chars,
    stop_reason: result.stop_reason, error: result.error, provider_error: result.provider_error }))
  return result
}

output.metadata = supplement ? null : await request('/v1/models/' + original.model, null, 'model metadata', 20000)
await persist()
output.count = supplement ? null : await request('/v1/messages/count_tokens', Object.fromEntries(Object.entries(original)
  .filter(([k]) => ['model','system','messages','tools','tool_choice','thinking'].includes(k))), 'original token count', 30000)
await persist()
const small = { model: original.model, max_tokens: 2048, thinking: { type: 'adaptive' }, output_config: { effort: 'max' }, stream: true,
  messages: [{ role: 'user', content: 'Find the smallest positive integer n with n mod 7 = 3, n mod 11 = 5, n mod 13 = 7. Return only n.' }] }
let expected = 1
while (!(expected % 7 === 3 && expected % 11 === 5 && expected % 13 === 7)) expected++
output.small_answer_control = expected
const cases = supplement ? [
  ['history/medium/summarized', { ...original, max_tokens: 4096, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'medium' } }],
  ['history/high/summarized', { ...original, max_tokens: 4096, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'high' } }],
  ['history/max/8192/omitted', { ...original, max_tokens: 8192, thinking: { type: 'adaptive' } }],
] : [
  ['small/max/omitted', small],
  ['small/max/summarized', { ...small, thinking: { type: 'adaptive', display: 'summarized' } }],
  ['history/max/omitted', { ...original, max_tokens: 4096, thinking: { type: 'adaptive' } }],
  ['history/max/summarized', { ...original, max_tokens: 4096, thinking: { type: 'adaptive', display: 'summarized' } }],
  ['history/low/summarized', { ...original, max_tokens: 4096, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'low' } }],
  ['small/max/tiny-budget-control', { ...small, max_tokens: 16, thinking: { type: 'adaptive', display: 'summarized' } }],
]
for (const [label, body] of cases) {
  const r = await request('/v1/messages', body, label)
  if (label.startsWith('small/') && !label.includes('tiny-budget') && r.complete) r.answer_matches_control = r.text_preview?.trim() === String(expected)
  r.input_slice = label.startsWith('history/') ? `Original system/tools/messages retained; output cap changed from 125000 to ${body.max_tokens}.` : 'Small deterministic math task.'
  output.cases.push(r)
  await persist()
}
output.finished = new Date().toISOString()
output.inference_requests = inferenceCount
output.scope = 'Direct diagnostic H2 transport; no OpenCode processor/TUI or tool execution. One ordered pair is not a latency benchmark.'
await persist()
console.log('RESULT ' + path.join(here, resultFile))
