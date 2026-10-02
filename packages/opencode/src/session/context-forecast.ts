export type ContextForecast = {
  turnsLeft: number | null
  atLeast: boolean
  nextTokens: number | null
  samples: number
  method: "exponential" | "recent" | "unknown"
}

type Curve = { a: number; c: number; q: number; error: number }
const MAX_SAMPLES = 64
const HORIZON = 1024

// Constrained least squares in token space: c + a*q^i. For fixed q the
// coefficients are linear; search q on a bounded grid, then refine locally.
function fit(values: readonly number[]): Curve {
  const n = values.length
  const sumY = values.reduce((sum, y) => sum + y, 0)
  let best: Curve = { a: 0, c: sumY / n, q: 1, error: Infinity }
  let low = 0
  let high = 1
  for (let round = 0; round < 4; round++) {
    const stride = (high - low) / 100
    for (let j = 0; j <= 100; j++) {
      const q = low + stride * j
      let x = 1
      let sumX = 0
      let sumXX = 0
      let sumXY = 0
      for (const y of values) {
        sumX += x
        sumXX += x * x
        sumXY += x * y
        x *= q
      }
      const determinant = n * sumXX - sumX * sumX
      let a = determinant > 1e-12 ? (n * sumXY - sumX * sumY) / determinant : 0
      let c = (sumY - a * sumX) / n
      if (a < 0) { a = 0; c = sumY / n }
      if (c < 0) { c = 0; a = sumXY / sumXX }
      x = 1
      let error = 0
      for (const y of values) {
        error += (y - c - a * x) ** 2
        x *= q
      }
      if (error < best.error) best = { a, c, q, error }
    }
    low = Math.max(0, best.q - stride)
    high = Math.min(1, best.q + stride)
  }
  return best
}

export function forecastContext(growth: readonly number[], headroom: number): ContextForecast {
  const values = growth.slice(-MAX_SAMPLES)
  const unknown: ContextForecast = { turnsLeft: null, atLeast: false, nextTokens: null, samples: values.length, method: "unknown" }
  if (values.length < 4 || values.some((y) => !Number.isFinite(y) || y < 0)) return unknown
  const recent = values.slice(-4).reduce((sum, y) => sum + y, 0) / Math.min(4, values.length)
  if (recent <= 0) return unknown

  // The last sample is held out: a decaying shape must predict it, rather
  // than merely fit the points it was given. Noisy/increasing work stays recent.
  const training = fit(values.slice(0, -1))
  const last = values.at(-1)!
  const predicted = training.c + training.a * training.q ** (values.length - 1)
  const mean = values.reduce((sum, y) => sum + y, 0) / values.length
  const trainedMean = values.slice(0, -1).reduce((sum, y) => sum + y, 0) / (values.length - 1)
  const rmse = Math.sqrt(training.error / (values.length - 1))
  const exponential = training.a > 0 && training.q < 1 &&
    rmse <= trainedMean * 0.35 && Math.abs(predicted - last) <= mean * 0.35
  const curve = exponential ? fit(values) : { a: 0, c: recent, q: 1, error: 0 }
  const nextTokens = curve.c + curve.a * curve.q ** values.length
  let spent = 0
  let turnsLeft = 0
  while (turnsLeft < HORIZON) {
    const cost = curve.c + curve.a * curve.q ** (values.length + turnsLeft)
    if (spent + cost > Math.max(0, headroom)) break
    spent += cost
    turnsLeft++
  }
  return { turnsLeft, atLeast: turnsLeft === HORIZON, nextTokens, samples: values.length, method: exponential ? "exponential" : "recent" }
}

export function formatForecast(forecast: ContextForecast): string {
  // «model requests», not «turns»: the series counts requests to the model (steps), and one user turn holds many
  // of them — the steps-vs-turns confusion misread a summary count as «0/79 vectors» the same day (2026-10-02).
  if (forecast.turnsLeft === null) return "Model requests before compact: estimate unavailable yet — collecting stable-prefix request growth. Continue the current task."
  const count = forecast.turnsLeft.toLocaleString("en-US")
  return `By calculation: ${forecast.atLeast ? "at least" : "approximately"} ${count} more model requests before compact (${forecast.method === "exponential" ? "exponential least squares" : "recent step growth"}, ${forecast.samples} samples; estimate).`
}

export function formatContextBudget(input: { open: number; limit: number; foldAt: number; forecast: ContextForecast }): string {
  return `Your context window: ${input.open.toLocaleString("en-US")} of ${input.limit.toLocaleString("en-US")} tokens. ${formatForecast(input.forecast)} Compact threshold: ${input.foldAt.toLocaleString("en-US")} tokens.`
}

export const COMPACT_CONTINUATION = "This is the current window, not a limit on completing the task. Use compact at a completed boundary, then continue from the preserved state."
