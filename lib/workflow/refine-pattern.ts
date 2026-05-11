/**
 * Refine-pattern workflow: critic ↔ modifier ↔ cloth-sim loop.
 *
 * Cycle:
 *   1. Drape the current pattern (cloth-sim).
 *   2. Critic looks at the drape metrics + reference dim + pattern dims.
 *   3. If `should_modify=false` → done, return final pattern + drape.
 *   4. Modifier applies the deltas.
 *   5. Repeat up to `maxCycles` (default 3).
 *
 * Returns a history of cycles so the UI can show the progression.
 */

import type { GcdPattern, ReferenceMeasurement } from "@/lib/garment-gpt";
import { drapeWithWarp, type DrapeMetrics, type DrapeResult } from "@/lib/cloth-sim";
import { critique, type CriticOutput } from "@/lib/agents/critic";
import { applyDeltas } from "@/lib/agents/modifier";

export type RefineCycle = {
  cycle: number;
  drape: DrapeResult;
  critique: CriticOutput;
};

export type RefineResult = {
  cycles: RefineCycle[];
  finalPattern: GcdPattern;
  finalDrape: DrapeResult;
  converged: boolean;
};

export async function refinePattern(input: {
  pattern: GcdPattern;
  referenceMeasurement?: ReferenceMeasurement;
  maxCycles?: number;
  fabric?: string;
  onCycle?: (c: RefineCycle) => void;
}): Promise<RefineResult> {
  const maxCycles = input.maxCycles ?? 3;
  const cycles: RefineCycle[] = [];
  let currentPattern: GcdPattern = input.pattern;
  let finalDrape: DrapeResult | null = null;
  let converged = false;

  for (let i = 1; i <= maxCycles; i++) {
    const drape = await drapeWithWarp(currentPattern, {
      fabric: input.fabric,
    });
    finalDrape = drape;
    const critic = await critique({
      pattern: currentPattern,
      drapeMetrics: drape.metrics,
      referenceMeasurement: input.referenceMeasurement,
    });
    const cycle: RefineCycle = { cycle: i, drape, critique: critic };
    cycles.push(cycle);
    input.onCycle?.(cycle);
    if (!critic.should_modify || critic.deltas.length === 0) {
      converged = true;
      break;
    }
    currentPattern = applyDeltas(currentPattern, critic.deltas);
  }

  if (!finalDrape) throw new Error("no cycles ran");
  return {
    cycles,
    finalPattern: currentPattern,
    finalDrape,
    converged,
  };
}
