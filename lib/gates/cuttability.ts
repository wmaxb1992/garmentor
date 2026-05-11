/**
 * Cuttability gate: would these panels actually cut on a fabric roll?
 *
 * Checks per panel:
 *   - Polygon is simple (no self-intersection).
 *   - All edge tangent changes leave radius >= MIN_RADIUS_MM (so a cutter can follow).
 *
 * Checks across panels:
 *   - When laid out on a 150 cm wide fabric roll (sorted tall-first), no two
 *     panels overlap. Uses axis-aligned-bbox first-pass, then polygon SAT for
 *     the survivors.
 */

import { panelToPolyline } from "@/lib/gcd-to-dxf";
import type { GcdPattern } from "@/lib/garment-gpt";

const MIN_RADIUS_MM = 2;
const FABRIC_WIDTH_CM_DEFAULT = 150;
const PAD_CM = 0.5; // minimum spacing between panels when nested

type Pt = [number, number];

function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function bbox(poly: Pt[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function isSimple(poly: Pt[]): boolean {
  // O(n^2) segment-segment intersection. n is panel vertex count (~30-100), fine.
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent edges
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (d === 0) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

function minTurnRadius(poly: Pt[]): number {
  // Discrete curvature ≈ 2 * sin(θ/2) / |edge|. Smallest implied osculating
  // circle radius across the polygon. In source units (cm).
  let minR = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[(i - 1 + n) % n];
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const v1 = [x1 - x0, y1 - y0];
    const v2 = [x2 - x1, y2 - y1];
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const ang = Math.atan2(Math.abs(cross), dot);
    if (ang < 1e-3) continue;
    const seg = Math.min(Math.hypot(v1[0], v1[1]), Math.hypot(v2[0], v2[1]));
    const r = seg / (2 * Math.sin(ang / 2 + 1e-6));
    if (r < minR) minR = r;
  }
  return minR;
}

function polygonsOverlap(a: Pt[], b: Pt[]): boolean {
  // Separating Axis Theorem on the union of both polygons' edge normals.
  const polys = [a, b];
  for (let p = 0; p < 2; p++) {
    const poly = polys[p];
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = -(y2 - y1);
      const ny = x2 - x1;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const [x, y] of a) {
        const proj = nx * x + ny * y;
        if (proj < minA) minA = proj;
        if (proj > maxA) maxA = proj;
      }
      for (const [x, y] of b) {
        const proj = nx * x + ny * y;
        if (proj < minB) minB = proj;
        if (proj > maxB) maxB = proj;
      }
      if (maxA < minB || maxB < minA) return false; // gap on this axis → separated
    }
  }
  return true;
}

export type CuttabilityResult = {
  pass: boolean;
  failures: Array<{ panel?: string; message: string }>;
  totalAreaCm2: number;
};

export function cuttabilityCheck(
  pattern: GcdPattern,
  fabricWidthCm: number = FABRIC_WIDTH_CM_DEFAULT,
): CuttabilityResult {
  const failures: CuttabilityResult["failures"] = [];
  let totalAreaCm2 = 0;
  const placed: Array<{ name: string; poly: Pt[] }> = [];

  // Per-panel checks.
  const order = pattern.pattern.panel_order?.length
    ? pattern.pattern.panel_order
    : Object.keys(pattern.pattern.panels);
  const panelPolys: Array<{ name: string; poly: Pt[]; w: number; h: number }> = [];
  for (const name of order) {
    const panel = pattern.pattern.panels[name];
    if (!panel) continue;
    const poly = panelToPolyline(panel);
    if (poly.length < 3) {
      failures.push({ panel: name, message: "fewer than 3 vertices" });
      continue;
    }
    if (!isSimple(poly)) {
      failures.push({ panel: name, message: "polygon self-intersects" });
    }
    const r = minTurnRadius(poly);
    const rmm = r * 10; // cm → mm
    if (rmm < MIN_RADIUS_MM) {
      failures.push({
        panel: name,
        message: `tightest turn radius ${rmm.toFixed(1)} mm < ${MIN_RADIUS_MM} mm minimum`,
      });
    }
    const [minX, minY, maxX, maxY] = bbox(poly);
    const w = maxX - minX;
    const h = maxY - minY;
    if (w > fabricWidthCm) {
      failures.push({
        panel: name,
        message: `width ${w.toFixed(1)} cm exceeds fabric width ${fabricWidthCm} cm`,
      });
    }
    totalAreaCm2 += polygonArea(poly);
    panelPolys.push({ name, poly, w, h });
  }

  // Row-pack panels (tallest-first) onto the fabric and check pairwise overlap.
  panelPolys.sort((a, b) => b.h - a.h);
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const p of panelPolys) {
    if (cursorX > 0 && cursorX + p.w > fabricWidthCm) {
      cursorX = 0;
      cursorY += rowHeight + PAD_CM;
      rowHeight = 0;
    }
    const [minX, minY] = bbox(p.poly);
    const tx = cursorX - minX;
    const ty = cursorY - minY;
    const placedPoly: Pt[] = p.poly.map(([x, y]) => [x + tx, y + ty]);
    for (const prev of placed) {
      const [aMinX, aMinY, aMaxX, aMaxY] = bbox(prev.poly);
      const [bMinX, bMinY, bMaxX, bMaxY] = bbox(placedPoly);
      if (aMaxX < bMinX || bMaxX < aMinX || aMaxY < bMinY || bMaxY < aMinY) continue;
      if (polygonsOverlap(prev.poly, placedPoly)) {
        failures.push({
          panel: p.name,
          message: `overlaps ${prev.name} when nested on ${fabricWidthCm} cm fabric`,
        });
      }
    }
    placed.push({ name: p.name, poly: placedPoly });
    cursorX += p.w + PAD_CM;
    if (p.h > rowHeight) rowHeight = p.h;
  }

  return {
    pass: failures.length === 0,
    failures,
    totalAreaCm2,
  };
}
