/**
 * CodeGraph + summary Exact smoke fixture (not gitignored).
 * Unique marker IDs — do not rename without updating smoke queries.
 */
import { CG_PROBE_ID_ALPHA_7f3a9c2e1b84, cgProbeFnAlpha7f3a9c2e1b84 } from "./cg_probe_alpha"

export const CG_PROBE_ID_BETA_91d4e6a0c55f = "CG_PROBE_ID_BETA_91d4e6a0c55f"

export function cgProbeFnBeta91d4e6a0c55f(): string {
  return cgProbeFnAlpha7f3a9c2e1b84(CG_PROBE_ID_BETA_91d4e6a0c55f)
}

export { CG_PROBE_ID_ALPHA_7f3a9c2e1b84 }
