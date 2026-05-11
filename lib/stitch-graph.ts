/**
 * GCD → cloth-sim stitching graph.
 *
 * The Warp cloth simulator needs:
 *   - per-panel triangulated meshes (positions in 2D + index buffer)
 *   - panel placements in 3D (translation + rotation)
 *   - "stitch" constraints: pairs of vertex indices that must coincide after
 *     simulation. These come from GCD's `stitches` field which references
 *     panel edges; we resample each pair of stitched edges at matched
 *     parametric positions to produce vertex-vertex pin constraints.
 *
 * This module is platform-neutral TypeScript. The actual sim runs on Warp
 * (Python on GPU); this just precomputes the input shape so the handler is
 * dumb and stateless.
 */

import { panelToPolyline } from "@/lib/gcd-to-dxf";
import type { GcdPattern, GcdPanel } from "@/lib/garment-gpt";

const SAMPLES_PER_STITCH = 12;

export type Vec3 = [number, number, number];

export type ClothPanel = {
  name: string;
  /** Flat 2D vertices: [x0,y0,x1,y1,...]. Length = 2 * vertexCount. */
  vertices2D: number[];
  /** Triangle index buffer (3 indices per tri). */
  triangles: number[];
  /** Panel placement in 3D (from GCD). */
  translation: Vec3;
  rotation: number[]; // quat (w,x,y,z) or euler depending on GCD's storage
  /** Vertices on the outer perimeter, in order. Useful for stitch resampling. */
  perimeter: number[];
};

export type StitchPin = {
  /** Indices into the *global* vertex array (panel index + local). */
  a: { panel: number; vertex: number };
  b: { panel: number; vertex: number };
};

export type ClothInput = {
  panels: ClothPanel[];
  stitches: StitchPin[];
};

/**
 * Sample N points uniformly along a closed polyline.
 * Returns indices into the polyline (interpolating between vertices).
 */
function sampleAlongEdgeVertices(
  polyline: Array<[number, number]>,
  edgeStartIdx: number,
  edgeEndIdx: number,
  n: number,
): number[] {
  // Walk vertices from edgeStartIdx to edgeEndIdx, both inclusive, returning
  // n evenly-spaced vertex indices. If edgeEnd < edgeStart we wrap.
  const len = polyline.length;
  const segmentVerts: number[] = [];
  let i = edgeStartIdx;
  segmentVerts.push(i);
  while (i !== edgeEndIdx) {
    i = (i + 1) % len;
    segmentVerts.push(i);
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * (segmentVerts.length - 1);
    out.push(segmentVerts[Math.round(t)]);
  }
  return out;
}

/**
 * Heuristic ear-clipping triangulation for a simple polygon. Returns triangle
 * indices into the input polygon array. Robust to non-convex outlines.
 *
 * Production code would use `earcut` (~5 KB MIT lib); inlined here so the
 * file has zero deps.
 */
function earClipTriangulate(poly: Array<[number, number]>): number[] {
  const n = poly.length;
  if (n < 3) return [];
  const indices: number[] = Array.from({ length: n }, (_, i) => i);
  const tris: number[] = [];

  const area2 = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

  const signedArea = () => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % n];
      s += x1 * y2 - x2 * y1;
    }
    return s;
  };

  // Reverse if CW.
  if (signedArea() < 0) indices.reverse();

  const inside = (a: [number, number], b: [number, number], c: [number, number], p: [number, number]) => {
    const d1 = area2(p, a, b);
    const d2 = area2(p, b, c);
    const d3 = area2(p, c, a);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  let guard = indices.length * 3;
  while (indices.length > 3 && guard-- > 0) {
    let cut = false;
    for (let i = 0; i < indices.length; i++) {
      const i0 = indices[(i - 1 + indices.length) % indices.length];
      const i1 = indices[i];
      const i2 = indices[(i + 1) % indices.length];
      const a = poly[i0];
      const b = poly[i1];
      const c = poly[i2];
      if (area2(a, b, c) <= 0) continue; // not convex
      let bad = false;
      for (const j of indices) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inside(a, b, c, poly[j])) {
          bad = true;
          break;
        }
      }
      if (bad) continue;
      tris.push(i0, i1, i2);
      indices.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (indices.length === 3) tris.push(indices[0], indices[1], indices[2]);
  return tris;
}

/**
 * Triangulate a single GCD panel via ear-clipping on its perimeter polyline.
 * Returns the outline vertices (positions) + tri indices. The outline vertices
 * are also the perimeter ring for stitch lookups.
 */
function triangulatePanel(panel: GcdPanel): {
  vertices2D: number[];
  triangles: number[];
  perimeter: number[];
} {
  const poly = panelToPolyline(panel);
  const flat: number[] = [];
  for (const [x, y] of poly) {
    flat.push(x, y);
  }
  const tris = earClipTriangulate(poly);
  const perimeter = poly.map((_, i) => i);
  return { vertices2D: flat, triangles: tris, perimeter };
}

/**
 * Build the full cloth-sim input from a GCD pattern.
 */
export function buildClothInput(pattern: GcdPattern): ClothInput {
  const order = pattern.pattern.panel_order?.length
    ? pattern.pattern.panel_order
    : Object.keys(pattern.pattern.panels);

  const panels: ClothPanel[] = [];
  const nameToIndex: Record<string, number> = {};
  for (const name of order) {
    const gcd = pattern.pattern.panels[name];
    if (!gcd) continue;
    const tri = triangulatePanel(gcd);
    if (tri.vertices2D.length < 6 || tri.triangles.length < 3) continue; // skip empty panels
    nameToIndex[name] = panels.length;
    panels.push({
      name,
      vertices2D: tri.vertices2D,
      triangles: tri.triangles,
      perimeter: tri.perimeter,
      translation: [gcd.translation[0], gcd.translation[1], gcd.translation[2]],
      rotation: gcd.rotation,
    });
  }

  const stitches: StitchPin[] = [];
  for (const stitch of pattern.pattern.stitches ?? []) {
    if (stitch.length !== 2) continue;
    const [a, b] = stitch;
    const ai = nameToIndex[a.panel];
    const bi = nameToIndex[b.panel];
    if (ai == null || bi == null) continue;
    const panelA = pattern.pattern.panels[a.panel];
    const panelB = pattern.pattern.panels[b.panel];
    const polyA = panelToPolyline(panelA);
    const polyB = panelToPolyline(panelB);
    const edgeA = panelA.edges[a.edge];
    const edgeB = panelB.edges[b.edge];
    if (!edgeA || !edgeB) continue;
    const sA = sampleAlongEdgeVertices(
      polyA,
      edgeA.endpoints[0],
      edgeA.endpoints[1],
      SAMPLES_PER_STITCH,
    );
    const sB = sampleAlongEdgeVertices(
      polyB,
      edgeB.endpoints[0],
      edgeB.endpoints[1],
      SAMPLES_PER_STITCH,
    ).reverse(); // stitched edges run anti-parallel
    const n = Math.min(sA.length, sB.length);
    for (let i = 0; i < n; i++) {
      stitches.push({
        a: { panel: ai, vertex: sA[i] },
        b: { panel: bi, vertex: sB[i] },
      });
    }
  }

  return { panels, stitches };
}
