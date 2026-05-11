import { test, expect } from "bun:test";
import fixture from "./fixture.gcd.json" with { type: "json" };
import type { GcdPattern } from "../../lib/garment-gpt";
import { applyDeltas } from "../../lib/agents/modifier";
import { panelToPolyline } from "../../lib/gcd-to-dxf";

const base = fixture as unknown as GcdPattern;

function dims(pat: GcdPattern, name: string): { w: number; h: number } {
  const poly = panelToPolyline(pat.pattern.panels[name]);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { w: maxX - minX, h: maxY - minY };
}

test("modifier: width delta on a torso panel widens it ~2 cm", () => {
  const name = Object.keys(base.pattern.panels).find((n) => /torso/i.test(n))!;
  const before = dims(base, name);
  const after = applyDeltas(base, [{ panel: name, width_cm: 2 }]);
  const a = dims(after, name);
  expect(a.w).toBeGreaterThan(before.w + 1.5);
  expect(a.w).toBeLessThan(before.w + 2.5);
});

test("modifier: zero-delta is a no-op", () => {
  const same = applyDeltas(base, [{ chest_cm: 0, length_cm: 0 }]);
  for (const name of Object.keys(base.pattern.panels)) {
    const a = dims(base, name);
    const b = dims(same, name);
    if (!Number.isFinite(a.w) || !Number.isFinite(a.h)) continue; // skip empty panels
    expect(Math.abs(a.w - b.w)).toBeLessThan(0.01);
    expect(Math.abs(a.h - b.h)).toBeLessThan(0.01);
  }
});

test("modifier: sleeve delta only touches sleeve-named panels", () => {
  const sleeveNames = Object.keys(base.pattern.panels).filter((n) =>
    /(sleeve|btorso|arm)/i.test(n),
  );
  const nonSleeveNames = Object.keys(base.pattern.panels).filter(
    (n) => !/(sleeve|btorso|arm)/i.test(n),
  );
  const after = applyDeltas(base, [{ sleeve_cm: 3 }]);
  // Non-sleeve panels unchanged.
  for (const n of nonSleeveNames) {
    const a = dims(base, n);
    const b = dims(after, n);
    if (!Number.isFinite(a.h)) continue;
    expect(Math.abs(a.h - b.h)).toBeLessThan(0.01);
  }
  // At least one sleeve panel grew.
  const validSleeves = sleeveNames.filter((n) => Number.isFinite(dims(base, n).h));
  if (validSleeves.length > 0) {
    const grew = validSleeves.some(
      (n) => dims(after, n).h > dims(base, n).h + 0.5,
    );
    expect(grew).toBe(true);
  }
});
