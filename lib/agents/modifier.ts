/**
 * Modifier agent: applies grade deltas from the critic to a GcdPattern.
 *
 * Strategy: translate the relevant cardinal grade points (CB/CF/hem/etc.)
 * by the requested cm delta. We don't have explicit grade-point labels in
 * GarmentGPT output, so we use bounding-box heuristics:
 *   - length_cm  → move the bottom-most vertices down by N cm (positive Y = down in image space)
 *   - chest_cm   → spread left-most + right-most vertices outward by N/2 cm each
 *   - sleeve_cm  → only applied to panels whose name contains "sleeve" or "btorso"
 *   - width_cm   → uniform stretch in X
 *
 * For a real production system you'd want labeled grade points (CB/CF/HPS/
 * hem/armscye) per garment category. This is the v1 heuristic.
 */

import type { GcdPattern } from "@/lib/garment-gpt";
import type { CriticOutput } from "@/lib/agents/critic";

type Vec2 = [number, number];

function bbox(vertices: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of vertices) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function applyLengthDelta(vertices: Vec2[], cm: number): Vec2[] {
  if (Math.abs(cm) < 0.1) return vertices;
  const { minY, maxY } = bbox(vertices);
  const range = maxY - minY;
  if (range <= 0) return vertices;
  // Push only the bottom half down by cm, weighted by (y - minY) / range.
  return vertices.map(([x, y]) => {
    const weight = (y - minY) / range;
    return [x, y + cm * weight];
  });
}

function applyChestDelta(vertices: Vec2[], cm: number): Vec2[] {
  if (Math.abs(cm) < 0.1) return vertices;
  const { minX, maxX } = bbox(vertices);
  const mid = (minX + maxX) / 2;
  return vertices.map(([x, y]) => {
    const dx = x - mid;
    const sign = Math.sign(dx);
    return [x + sign * (cm / 2), y];
  });
}

function applyWidthDelta(vertices: Vec2[], cm: number): Vec2[] {
  if (Math.abs(cm) < 0.1) return vertices;
  const { minX, maxX } = bbox(vertices);
  const cur = maxX - minX;
  if (cur <= 0) return vertices;
  const scale = (cur + cm) / cur;
  const cx = (minX + maxX) / 2;
  return vertices.map(([x, y]) => [cx + (x - cx) * scale, y]);
}

export function applyDeltas(pattern: GcdPattern, deltas: CriticOutput["deltas"]): GcdPattern {
  const next: GcdPattern = JSON.parse(JSON.stringify(pattern));
  for (const delta of deltas) {
    const targets = delta.panel
      ? [delta.panel]
      : Object.keys(next.pattern.panels);
    for (const name of targets) {
      const panel = next.pattern.panels[name];
      if (!panel) continue;
      let verts = panel.vertices as Vec2[];
      if (delta.length_cm) verts = applyLengthDelta(verts, delta.length_cm);
      if (delta.chest_cm && /(torso|front|back|body)/i.test(name))
        verts = applyChestDelta(verts, delta.chest_cm);
      if (delta.sleeve_cm && /(sleeve|btorso|arm)/i.test(name))
        verts = applyLengthDelta(verts, delta.sleeve_cm);
      if (delta.width_cm) verts = applyWidthDelta(verts, delta.width_cm);
      panel.vertices = verts;
    }
  }
  return next;
}
