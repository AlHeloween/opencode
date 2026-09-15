/**
 * Codegraph smoke test — experiments/2026-08-04_codegraph-smoke.ts
 * Verify that codegraph indexes new files, symbols, and cross-file edges after creation + edit.
 */

export interface SmokeConfig {
  /** Label for the smoke run */
  label: string;
  /** Max retries before failing */
  retries: number;
  /** Whether to collect verbose logs */
  verbose: boolean;
}

const DEFAULT_CONFIG: SmokeConfig = {
  label: "default",
  retries: 3,
  verbose: false,
};

export function runSmoke(config: Partial<SmokeConfig> = {}): SmokeResult {
  const merged = { ...DEFAULT_CONFIG, ...config };
  return executeSmoke(merged);
}

export interface SmokeResult {
  passed: boolean;
  durationMs: number;
  logs: string[];
}

function executeSmoke(cfg: SmokeConfig): SmokeResult {
  const start = Date.now();
  const logs: string[] = [];

  logs.push(`[smoke] starting: ${cfg.label}`);

  let passed = true;
  for (let i = 0; i < cfg.retries; i++) {
    const ok = smokeStep(cfg, i);
    if (cfg.verbose) {
      logs.push(`[smoke] attempt ${i + 1}/${cfg.retries}: ${ok ? "PASS" : "FAIL"}`);
    }
    if (!ok) passed = false;
  }

  const durationMs = Date.now() - start;
  logs.push(`[smoke] done: ${passed ? "PASS" : "FAIL"} (${durationMs}ms)`);

  return { passed, durationMs, logs };
}

function smokeStep(cfg: SmokeConfig, attempt: number): boolean {
  // Simulate a flaky check — pass on even attempts
  return attempt % 2 === 0 || cfg.verbose;
}

// === Added via edit (step 3) ===

export class SmokeRunner {
  private results: SmokeResult[] = [];

  constructor(private readonly defaultConfig: SmokeConfig = DEFAULT_CONFIG) {}

  /** Run a single smoke and record the result */
  add(label: string, overrides?: Partial<SmokeConfig>): SmokeResult {
    const config = { ...this.defaultConfig, ...overrides, label };
    const result = runSmoke(config);
    this.results.push(result);
    return result;
  }

  /** Run a batch of smokes in parallel (simulated) */
  addBatch(labels: string[]): SmokeResult[] {
    return labels.map((label) => this.add(label));
  }

  /** Aggregate stats across all recorded runs */
  summary(): SmokeSummary {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    const totalMs = this.results.reduce((sum, r) => sum + r.durationMs, 0);
    return { total, passed, failed: total - passed, totalMs };
  }
}

export interface SmokeSummary {
  total: number;
  passed: number;
  failed: number;
  totalMs: number;
}

/** Run the same smoke across multiple configs */
export function batchSmoke(
  label: string,
  configs: Partial<SmokeConfig>[]
): SmokeResult[] {
  const runner = new SmokeRunner();
  return configs.map((cfg) => runner.add(label, cfg));
}
