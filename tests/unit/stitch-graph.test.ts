import { test, expect } from "bun:test";
import fixture from "./fixture.gcd.json" with { type: "json" };
import type { GcdPattern } from "../../lib/garment-gpt";
import { buildClothInput } from "../../lib/stitch-graph";

const base = fixture as unknown as GcdPattern;

test("stitch-graph: produces one cloth panel per non-empty GCD panel", () => {
  const ci = buildClothInput(base);
  const nonEmpty = Object.values(base.pattern.panels).filter(
    (p) => p.vertices.length >= 3 && p.edges.length > 0,
  ).length;
  expect(ci.panels.length).toBe(nonEmpty);
});

test("stitch-graph: every panel has triangles and ≥3 vertices", () => {
  const ci = buildClothInput(base);
  for (const p of ci.panels) {
    expect(p.vertices2D.length).toBeGreaterThanOrEqual(6); // ≥3 (x,y) pairs
    expect(p.triangles.length).toBeGreaterThanOrEqual(3); // ≥1 triangle
    expect(p.triangles.length % 3).toBe(0);
  }
});

test("stitch-graph: triangle indices are within vertex range", () => {
  const ci = buildClothInput(base);
  for (const p of ci.panels) {
    const vCount = p.vertices2D.length / 2;
    for (const idx of p.triangles) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(vCount);
    }
  }
});

test("stitch-graph: stitch pin indices are valid for their panels", () => {
  const ci = buildClothInput(base);
  for (const s of ci.stitches) {
    const pA = ci.panels[s.a.panel];
    const pB = ci.panels[s.b.panel];
    expect(pA).toBeDefined();
    expect(pB).toBeDefined();
    expect(s.a.vertex).toBeLessThan(pA.vertices2D.length / 2);
    expect(s.b.vertex).toBeLessThan(pB.vertices2D.length / 2);
  }
});

test("stitch-graph: stitch count scales with GCD stitches × samples", () => {
  const ci = buildClothInput(base);
  // 18 stitches × 12 samples/stitch = 216 pins (upper bound; some are dropped on validation)
  expect(ci.stitches.length).toBeGreaterThan(0);
  expect(ci.stitches.length).toBeLessThanOrEqual(
    (base.pattern.stitches?.length ?? 0) * 12,
  );
});
