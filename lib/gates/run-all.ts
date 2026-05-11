import type { GcdPattern } from "@/lib/garment-gpt";
import type { CriticOutput } from "@/lib/agents/critic";
import { cuttabilityCheck, type CuttabilityResult } from "@/lib/gates/cuttability";
import { yardageCheck, type YardageResult } from "@/lib/gates/yardage";
import { stitchCheck, type StitchResult } from "@/lib/gates/stitch";

export type GatesResult = {
  pass: boolean;
  cuttability: CuttabilityResult;
  yardage: YardageResult;
  stitch: StitchResult;
  /** Modifier-compatible deltas you can apply to attempt an auto-fix. */
  proposedDeltas: CriticOutput["deltas"];
};

export type GatesOptions = {
  fabricWidthCm?: number;
  budgetYards?: number;
  costPerYardUsd?: number;
  stitchTolerancePct?: number;
};

export function runAllGates(
  pattern: GcdPattern,
  opts: GatesOptions = {},
): GatesResult {
  const cuttability = cuttabilityCheck(pattern, opts.fabricWidthCm);
  const yardage = yardageCheck(pattern, {
    fabricWidthCm: opts.fabricWidthCm,
    budgetYards: opts.budgetYards,
    costPerYardUsd: opts.costPerYardUsd,
  });
  const stitch = stitchCheck(pattern, opts.stitchTolerancePct);

  // Translate failures into modifier-compatible deltas.
  const proposedDeltas: CriticOutput["deltas"] = [];

  for (const f of cuttability.failures) {
    if (!f.panel) continue;
    const m = /width (\d+(?:\.\d+)?) cm exceeds fabric width (\d+) cm/.exec(f.message);
    if (m) {
      const cur = parseFloat(m[1]);
      const max = parseFloat(m[2]);
      proposedDeltas.push({ panel: f.panel, width_cm: -(cur - max + 1) });
    }
  }

  for (const f of stitch.failures) {
    // Shorten the longer edge by the mismatch. We use length delta on the panel
    // that owns the longer edge; for v1, just push a small length_cm correction.
    const long = f.lenACm > f.lenBCm ? f.a : f.b;
    const longLen = f.lenACm > f.lenBCm ? f.lenACm : f.lenBCm;
    const shortLen = f.lenACm > f.lenBCm ? f.lenBCm : f.lenACm;
    const cm = -(longLen - shortLen);
    proposedDeltas.push({ panel: long.panel, length_cm: cm });
  }

  return {
    pass: cuttability.pass && yardage.pass && stitch.pass,
    cuttability,
    yardage,
    stitch,
    proposedDeltas,
  };
}
