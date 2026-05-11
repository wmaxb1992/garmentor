/**
 * Yardage gate: how much fabric is needed, and does it fit a budget.
 *
 * Approach: row-pack panels (tallest-first) onto a fabric of given width and
 * return the total length consumed plus per-panel area. This is a lower-bound
 * estimate; a real CAD nest will pack better (~10-20% less waste).
 */

import { panelToPolyline } from "@/lib/gcd-to-dxf";
import type { GcdPattern } from "@/lib/garment-gpt";

const FABRIC_WIDTH_CM_DEFAULT = 150;
const PAD_CM = 0.5;
const YARD_CM = 91.44;

export type YardageResult = {
  pass: boolean;
  failures: Array<{ panel?: string; message: string }>;
  /** Length of fabric consumed at the given width, in centimeters. */
  consumedLengthCm: number;
  consumedYards: number;
  /** Sum of every panel's polygon area, cm². */
  totalAreaCm2: number;
  /** consumedAreaCm2 vs totalAreaCm2. Efficiency below 50% = lots of waste. */
  efficiencyPct: number;
  estimatedCost?: { perYardUsd: number; totalUsd: number };
};

export function yardageCheck(
  pattern: GcdPattern,
  options: {
    fabricWidthCm?: number;
    budgetYards?: number;
    costPerYardUsd?: number;
  } = {},
): YardageResult {
  const fabricWidthCm = options.fabricWidthCm ?? FABRIC_WIDTH_CM_DEFAULT;
  const failures: YardageResult["failures"] = [];

  const order = pattern.pattern.panel_order?.length
    ? pattern.pattern.panel_order
    : Object.keys(pattern.pattern.panels);
  const panels: Array<{ name: string; w: number; h: number; areaCm2: number }> = [];
  let totalAreaCm2 = 0;
  for (const name of order) {
    const p = pattern.pattern.panels[name];
    if (!p) continue;
    const poly = panelToPolyline(p);
    if (poly.length < 3) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if (x1 < minX) minX = x1;
      if (x1 > maxX) maxX = x1;
      if (y1 < minY) minY = y1;
      if (y1 > maxY) maxY = y1;
      area += x1 * y2 - x2 * y1;
    }
    area = Math.abs(area) / 2;
    totalAreaCm2 += area;
    let w = maxX - minX;
    let h = maxY - minY;
    // Rotate 90° if it makes the panel narrower-than-fabric AND taller (better packing).
    if (w > h && h <= fabricWidthCm) {
      [w, h] = [h, w];
    }
    panels.push({ name, w, h, areaCm2: area });
  }

  panels.sort((a, b) => b.h - a.h);
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const p of panels) {
    if (cursorX > 0 && cursorX + p.w > fabricWidthCm) {
      cursorX = 0;
      cursorY += rowHeight + PAD_CM;
      rowHeight = 0;
    }
    cursorX += p.w + PAD_CM;
    if (p.h > rowHeight) rowHeight = p.h;
  }
  const consumedLengthCm = cursorY + rowHeight;
  const consumedAreaCm2 = consumedLengthCm * fabricWidthCm;
  const efficiencyPct =
    consumedAreaCm2 > 0 ? (totalAreaCm2 / consumedAreaCm2) * 100 : 0;
  const consumedYards = consumedLengthCm / YARD_CM;

  if (options.budgetYards && consumedYards > options.budgetYards) {
    failures.push({
      message: `requires ${consumedYards.toFixed(2)} yd (over ${options.budgetYards} yd budget)`,
    });
  }

  let estimatedCost: YardageResult["estimatedCost"];
  if (options.costPerYardUsd) {
    estimatedCost = {
      perYardUsd: options.costPerYardUsd,
      totalUsd: consumedYards * options.costPerYardUsd,
    };
  }

  return {
    pass: failures.length === 0,
    failures,
    consumedLengthCm,
    consumedYards,
    totalAreaCm2,
    efficiencyPct,
    estimatedCost,
  };
}
