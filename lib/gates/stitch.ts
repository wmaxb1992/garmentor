/**
 * Stitch gate: verify every stitched edge pair has matched arc-length within
 * ±5% so the seam can actually close without buckling or gapping.
 */

import { panelToPolyline, edgeToPolylineIndices } from "@/lib/gcd-to-dxf";
import type { GcdPattern } from "@/lib/garment-gpt";

const TOLERANCE_PCT_DEFAULT = 5;

function edgeArcLength(
  poly: Array<[number, number]>,
  startIdx: number,
  endIdx: number,
): number {
  const n = poly.length;
  if (n === 0 || startIdx === endIdx) return 0;
  let len = 0;
  let i = startIdx;
  let guard = n + 1;
  while (i !== endIdx && guard-- > 0) {
    const j = (i + 1) % n;
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[j];
    len += Math.hypot(x2 - x1, y2 - y1);
    i = j;
  }
  return len;
}

export type StitchResult = {
  pass: boolean;
  failures: Array<{
    a: { panel: string; edge: number };
    b: { panel: string; edge: number };
    lenACm: number;
    lenBCm: number;
    mismatchPct: number;
    message: string;
  }>;
  checkedStitches: number;
};

export function stitchCheck(
  pattern: GcdPattern,
  tolerancePct: number = TOLERANCE_PCT_DEFAULT,
): StitchResult {
  const failures: StitchResult["failures"] = [];
  let checked = 0;

  for (const stitch of pattern.pattern.stitches ?? []) {
    if (stitch.length !== 2) continue;
    const [a, b] = stitch;
    const panelA = pattern.pattern.panels[a.panel];
    const panelB = pattern.pattern.panels[b.panel];
    if (!panelA || !panelB) continue;
    const edgeA = panelA.edges[a.edge];
    const edgeB = panelB.edges[b.edge];
    if (!edgeA || !edgeB) continue;
    const polyA = panelToPolyline(panelA);
    const polyB = panelToPolyline(panelB);
    // Map GCD edge indices to polyline indices (accounting for curve sampling).
    const mapA = edgeToPolylineIndices(panelA);
    const mapB = edgeToPolylineIndices(panelB);
    const rangeA = mapA[a.edge];
    const rangeB = mapB[b.edge];
    if (!rangeA || !rangeB) continue;
    const lenA = edgeArcLength(polyA, rangeA.startIdx, rangeA.endIdx);
    const lenB = edgeArcLength(polyB, rangeB.startIdx, rangeB.endIdx);
    const avg = (lenA + lenB) / 2;
    if (avg === 0) continue;
    const mismatch = (Math.abs(lenA - lenB) / avg) * 100;
    checked++;
    if (mismatch > tolerancePct) {
      failures.push({
        a,
        b,
        lenACm: lenA,
        lenBCm: lenB,
        mismatchPct: mismatch,
        message: `${a.panel} edge ${a.edge} (${lenA.toFixed(1)} cm) ↔ ${b.panel} edge ${b.edge} (${lenB.toFixed(1)} cm) — ${mismatch.toFixed(1)}% mismatch`,
      });
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    checkedStitches: checked,
  };
}
