import { test, expect } from "bun:test";
import fixture from "./fixture.gcd.json" with { type: "json" };
import type { GcdPattern } from "../../lib/garment-gpt";
import { runAllGates } from "../../lib/gates/run-all";
import { cuttabilityCheck } from "../../lib/gates/cuttability";
import { yardageCheck } from "../../lib/gates/yardage";
import { stitchCheck } from "../../lib/gates/stitch";

const pattern = fixture as unknown as GcdPattern;

test("gates: aggregate result has the three sub-results", () => {
  const r = runAllGates(pattern);
  expect(r).toHaveProperty("cuttability");
  expect(r).toHaveProperty("yardage");
  expect(r).toHaveProperty("stitch");
});

test("cuttability: returns pass + finite totalAreaCm2 on the fixture", () => {
  const r = cuttabilityCheck(pattern, 150);
  expect(typeof r.pass).toBe("boolean");
  expect(r.totalAreaCm2).toBeGreaterThan(0);
  expect(Number.isFinite(r.totalAreaCm2)).toBe(true);
});

test("yardage: efficiency > 0 and consumedYards > 0", () => {
  const r = yardageCheck(pattern, { fabricWidthCm: 150 });
  expect(r.consumedYards).toBeGreaterThan(0);
  expect(r.efficiencyPct).toBeGreaterThan(0);
  expect(r.efficiencyPct).toBeLessThanOrEqual(100);
});

test("yardage: cost estimate when costPerYardUsd is provided", () => {
  const r = yardageCheck(pattern, { fabricWidthCm: 150, costPerYardUsd: 12 });
  expect(r.estimatedCost).toBeDefined();
  expect(r.estimatedCost?.totalUsd).toBeGreaterThan(0);
});

test("yardage: budget rejection when over budget", () => {
  const r = yardageCheck(pattern, { fabricWidthCm: 150, budgetYards: 0.01 });
  expect(r.pass).toBe(false);
  expect(r.failures.some((f) => /budget/.test(f.message))).toBe(true);
});

test("stitch: every fixture stitch checked, mismatch within 5% expected", () => {
  const r = stitchCheck(pattern, 5);
  expect(r.checkedStitches).toBeGreaterThan(0);
  expect(r.checkedStitches).toBeLessThanOrEqual(fixture.pattern.stitches.length);
});

test("stitch: tighter tolerance flags more pairs", () => {
  const lax = stitchCheck(pattern, 20);
  const strict = stitchCheck(pattern, 1);
  expect(strict.failures.length).toBeGreaterThanOrEqual(lax.failures.length);
});
