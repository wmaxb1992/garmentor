import type { GcdPattern } from "@/lib/garment-gpt";
import { cuttabilityCheck, type CuttabilityResult } from "@/lib/gates/cuttability";
import { yardageCheck, type YardageResult } from "@/lib/gates/yardage";
import { stitchCheck, type StitchResult } from "@/lib/gates/stitch";

export type GatesResult = {
  pass: boolean;
  cuttability: CuttabilityResult;
  yardage: YardageResult;
  stitch: StitchResult;
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
  return {
    pass: cuttability.pass && yardage.pass && stitch.pass,
    cuttability,
    yardage,
    stitch,
  };
}
