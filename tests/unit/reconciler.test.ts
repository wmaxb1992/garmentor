import { test, expect } from "bun:test";
import fixture from "./fixture.gcd.json" with { type: "json" };
import type { GcdPattern } from "../../lib/garment-gpt";
import { reconcilePatterns } from "../../lib/agents/reconciler";
import { panelToPolyline } from "../../lib/gcd-to-dxf";

const base = fixture as unknown as GcdPattern;

function bboxW(p: { vertices: Array<[number, number]> }): number {
  const poly = panelToPolyline(p as never);
  let min = Infinity,
    max = -Infinity;
  for (const [x] of poly) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return max - min;
}

function scaledClone(pat: GcdPattern, sx: number): GcdPattern {
  const c: GcdPattern = JSON.parse(JSON.stringify(pat));
  for (const p of Object.values(c.pattern.panels)) {
    p.vertices = p.vertices.map(([x, y]) => [x * sx, y]);
  }
  return c;
}

test("reconciler: single pattern returns itself", () => {
  const out = reconcilePatterns([base]);
  expect(out.pattern.panels).toEqual(base.pattern.panels);
});

test("reconciler: median of 3 scaled views picks the middle scale", () => {
  const a = scaledClone(base, 0.5);
  const b = scaledClone(base, 1.0);
  const c = scaledClone(base, 1.5);
  const merged = reconcilePatterns([a, b, c]);
  // For every shared panel with non-zero width, merged width ≈ median (1.0x) within 5%.
  for (const name of Object.keys(base.pattern.panels)) {
    const baseW = bboxW(base.pattern.panels[name]);
    const mergedW = bboxW(merged.pattern.panels[name]);
    if (baseW <= 0 || !Number.isFinite(baseW) || !Number.isFinite(mergedW)) continue;
    const ratio = mergedW / baseW;
    expect(Math.abs(ratio - 1.0)).toBeLessThan(0.05);
  }
});

test("reconciler: unions stitches without duplicates", () => {
  const a: GcdPattern = JSON.parse(JSON.stringify(base));
  const b: GcdPattern = JSON.parse(JSON.stringify(base));
  // Pattern B has the same stitches.
  const merged = reconcilePatterns([a, b]);
  expect(merged.pattern.stitches.length).toBe(base.pattern.stitches.length);
});

test("reconciler: keeps panels unique to one view", () => {
  const a: GcdPattern = JSON.parse(JSON.stringify(base));
  const b: GcdPattern = JSON.parse(JSON.stringify(base));
  // Drop a panel from B.
  const dropped = Object.keys(b.pattern.panels)[0];
  delete b.pattern.panels[dropped];
  const merged = reconcilePatterns([a, b]);
  expect(merged.pattern.panels[dropped]).toBeDefined();
});
