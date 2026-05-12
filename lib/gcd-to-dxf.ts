import type { GcdEdge, GcdPanel, GcdPattern } from "@/lib/garment-gpt";

const BEZIER_STEPS = 24;
const ARC_STEPS = 32;

type Pt = [number, number];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// GarmentGPT stores cubic control points in "relative" coords: the edge from
// start->end is mapped to the unit x-axis, then control points are given in
// that frame. Inverse the transform to get world coords.
function denormalizeCubic(
  start: Pt,
  end: Pt,
  p1: Pt,
  p2: Pt,
): { c1: Pt; c2: Pt } {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return { c1: start, c2: end };
  const angle = Math.atan2(dy, dx);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const apply = (q: Pt): Pt => {
    const x = q[0] * len;
    const y = q[1] * len;
    return [start[0] + x * cos - y * sin, start[1] + x * sin + y * cos];
  };
  return { c1: apply(p1), c2: apply(p2) };
}

function sampleCubic(start: Pt, c1: Pt, c2: Pt, end: Pt, steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const it = 1 - t;
    const b0 = it * it * it;
    const b1 = 3 * it * it * t;
    const b2 = 3 * it * t * t;
    const b3 = t * t * t;
    out.push([
      b0 * start[0] + b1 * c1[0] + b2 * c2[0] + b3 * end[0],
      b0 * start[1] + b1 * c1[1] + b2 * c2[1] + b3 * end[1],
    ]);
  }
  return out;
}

function sampleArc(
  start: Pt,
  end: Pt,
  radius: number,
  largeFlag: number,
  sweepFlag: number,
  steps: number,
): Pt[] {
  // SVG-style arc: solve for center given endpoints, radius, flags.
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  let r = Math.abs(radius);
  const dsq = dx * dx + dy * dy;
  if (dsq === 0) return [end];
  if (r * r < dsq) r = Math.sqrt(dsq);
  const sign = largeFlag === sweepFlag ? -1 : 1;
  const sq = Math.max(0, (r * r - dsq) / dsq);
  const coef = sign * Math.sqrt(sq);
  const cx1 = coef * dy;
  const cy1 = -coef * dx;
  const cx = (x1 + x2) / 2 + cx1;
  const cy = (y1 + y2) / 2 + cy1;
  let a1 = Math.atan2(y1 - cy, x1 - cx);
  let a2 = Math.atan2(y2 - cy, x2 - cx);
  let delta = a2 - a1;
  if (sweepFlag === 0 && delta > 0) delta -= 2 * Math.PI;
  if (sweepFlag === 1 && delta < 0) delta += 2 * Math.PI;
  const out: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = a1 + delta * t;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function flattenEdge(panel: GcdPanel, edge: GcdEdge): Pt[] {
  const [a, b] = edge.endpoints;
  const start = panel.vertices[a];
  const end = panel.vertices[b];
  if (!start || !end) return [];
  if (!edge.curvature) return [end];
  if (edge.curvature.type === "cubic") {
    const [p1, p2] = edge.curvature.params;
    const { c1, c2 } = denormalizeCubic(start, end, p1, p2);
    return sampleCubic(start, c1, c2, end, BEZIER_STEPS);
  }
  if (edge.curvature.type === "circle") {
    const [radius, largeFlag, sweepFlag] = edge.curvature.params;
    return sampleArc(start, end, radius, largeFlag, sweepFlag, ARC_STEPS);
  }
  return [end];
}

export function panelToPolyline(panel: GcdPanel): Pt[] {
  if (panel.vertices.length === 0 || panel.edges.length === 0) return [];
  const poly: Pt[] = [panel.vertices[panel.edges[0].endpoints[0]]];
  for (const edge of panel.edges) {
    for (const p of flattenEdge(panel, edge)) poly.push(p);
  }
  return poly;
}

/**
 * Build a mapping from each edge index to the polyline index range
 * [startIdx, endIdx] (inclusive) produced by `panelToPolyline`.
 *
 * For edge `i`, `startIdx` is the polyline index corresponding to
 * `edge.endpoints[0]`, and `endIdx` to `edge.endpoints[1]`.
 */
export function edgeToPolylineIndices(
  panel: GcdPanel,
): Array<{ startIdx: number; endIdx: number }> {
  if (panel.edges.length === 0) return [];
  const result: Array<{ startIdx: number; endIdx: number }> = [];
  let cursor = 0; // polyline index of the current edge's start vertex
  for (const edge of panel.edges) {
    const count = flattenEdge(panel, edge).length;
    const endIdx = cursor + count;
    result.push({ startIdx: cursor, endIdx });
    cursor = endIdx;
  }
  return result;
}

const UNITS = { mm: 1, cm: 10, in: 25.4 } as const;
export type DxfUnit = keyof typeof UNITS;

function escape(s: string): string {
  return s.replace(/[\r\n]+/g, " ");
}

/**
 * Serialize a GCD pattern to a single DXF file (one LWPOLYLINE per panel).
 *
 * GarmentGPT outputs panel vertices in the units indicated by
 * `properties.units_in_meter` (e.g. 100 = centimeters). We convert to the
 * caller-requested DXF unit (mm by default).
 */
export function gcdToDxf(pattern: GcdPattern, unit: DxfUnit = "mm"): string {
  const sourceUnitsPerMeter = pattern.properties?.units_in_meter ?? 100;
  // mm per source-unit:
  const mmPerSource = 1000 / sourceUnitsPerMeter;
  const mmPerOut = UNITS[unit];
  const scale = mmPerSource / mmPerOut;

  const order = pattern.pattern.panel_order?.length
    ? pattern.pattern.panel_order
    : Object.keys(pattern.pattern.panels);

  const lines: string[] = [];
  lines.push("0", "SECTION", "2", "HEADER");
  lines.push("9", "$INSUNITS", "70", unit === "in" ? "1" : "4");
  lines.push("0", "ENDSEC");
  lines.push("0", "SECTION", "2", "ENTITIES");

  for (const name of order) {
    const panel = pattern.pattern.panels[name];
    if (!panel) continue;
    const poly = panelToPolyline(panel);
    if (poly.length < 2) continue;
    lines.push("0", "LWPOLYLINE", "8", escape(name), "90", String(poly.length), "70", "1");
    for (const [x, y] of poly) {
      lines.push("10", (x * scale).toFixed(4), "20", (y * scale).toFixed(4));
    }
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\n");
}
