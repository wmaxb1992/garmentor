/**
 * Auto-detect seam polylines from the source garment photo.
 *
 * Hunyuan3D-2 outputs a bare-geometry GLB (no UVs, no baked textures), so we
 * cannot read seams from the mesh itself. Instead we project each front-facing
 * vertex into the source image's pixel space and read luminance there. The
 * mesh is reconstructed from a single near-front photo, so the (x, y) plane
 * of the mesh aligns reasonably with the image's (column, row) up to scale.
 *
 *   1. Load and rasterize the source image to a hidden canvas.
 *   2. Compute the front-facing bounding box of the mesh in (x, y).
 *   3. Map every vertex (x, y) to image (u, v); back-facing vertices are
 *      assigned full brightness so they cannot be flagged as seams.
 *   4. Mark mesh edges whose midpoint luminance falls below an adaptive
 *      threshold and BFS the resulting dark subgraph for long polylines.
 *
 * Browser-only — uses HTMLImageElement and a <canvas>.
 */

import type { MergedMesh } from "./glb-mesh";
import type { SeamGraph } from "./seam-graph";

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Sample per-vertex luminance from the source photo via planar front-view
 * projection. Returns null if the image cannot be loaded or no front-facing
 * vertices exist.
 */
export async function sampleVertexLuminanceFromSource(
  sourceImageUrl: string,
  merged: MergedMesh,
): Promise<Float32Array | null> {
  const img = await loadImage(sourceImageUrl);
  if (!img) return null;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  let data: ImageData;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }

  const vCount = merged.positions.length / 3;
  const front = new Uint8Array(vCount);
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i < vCount; i++) {
    if (merged.normals[i * 3 + 2] > 0.05) {
      front[i] = 1;
      const x = merged.positions[i * 3];
      const y = merged.positions[i * 3 + 1];
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  if (!Number.isFinite(xMin)) return null;

  // Match the projection's aspect ratio to the image so the mapping doesn't
  // squash sleeves/torso. We grow whichever axis is too small.
  const aspect = w / h;
  let projW = xMax - xMin;
  let projH = yMax - yMin;
  if (projW <= 0 || projH <= 0) return null;
  if (projW / projH < aspect) projW = projH * aspect;
  else projH = projW / aspect;
  const xCenter = (xMin + xMax) * 0.5;
  const yCenter = (yMin + yMax) * 0.5;
  const xOrigin = xCenter - projW * 0.5;
  const yOrigin = yCenter - projH * 0.5;

  const lum = new Float32Array(vCount);
  for (let i = 0; i < vCount; i++) {
    if (!front[i]) {
      lum[i] = 1;
      continue;
    }
    const x = merged.positions[i * 3];
    const y = merged.positions[i * 3 + 1];
    const u = (x - xOrigin) / projW;
    const t = (y - yOrigin) / projH;
    const px = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
    const py = Math.min(h - 1, Math.max(0, Math.floor((1 - t) * h)));
    const idx = (py * w + px) * 4;
    const r = data.data[idx] / 255;
    const g = data.data[idx + 1] / 255;
    const b = data.data[idx + 2] / 255;
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return lum;
}

export type DetectOptions = {
  /** Edges below this percentile of midpoint luminance are considered "dark". */
  darknessPercentile?: number;
  /** Minimum vertices in a polyline to be emitted as a seam. */
  minPathVertices?: number;
  /** Maximum number of seams to return (longest first). */
  maxSeams?: number;
  /**
   * Absolute upper bound on the percentile threshold. If the texture has no
   * truly dark regions (the chosen percentile sits above this value), the
   * detector returns no seams instead of hallucinating mid-tone "seams".
   */
  absoluteCeiling?: number;
  /**
   * Reject any candidate path whose mean per-vertex luminance exceeds this.
   * Guards against the longest dark-subgraph path leaking through medium
   * vertices when components are barely connected.
   */
  pathMeanCeiling?: number;
};

function bfsFarthest(
  start: number,
  allowed: Uint8Array,
  graph: SeamGraph,
): { far: number; parent: Int32Array } {
  const n = graph.vertexCount;
  const parent = new Int32Array(n);
  parent.fill(-1);
  const visited = new Uint8Array(n);
  const queue: number[] = [start];
  visited[start] = 1;
  let far = start;
  while (queue.length > 0) {
    const u = queue.shift()!;
    far = u;
    const begin = graph.neighborOffsets[u];
    const end = graph.neighborOffsets[u + 1];
    for (let i = begin; i < end; i++) {
      const v = graph.neighbors[i];
      if (visited[v] || !allowed[v]) continue;
      visited[v] = 1;
      parent[v] = u;
      queue.push(v);
    }
  }
  return { far, parent };
}

export function detectDarkSeams(
  graph: SeamGraph,
  luminance: Float32Array,
  opts: DetectOptions = {},
): number[][] {
  const darknessPercentile = opts.darknessPercentile ?? 0.08;
  const minPathVertices = opts.minPathVertices ?? 6;
  const maxSeams = opts.maxSeams ?? 12;
  const absoluteCeiling = opts.absoluteCeiling ?? 0.45;
  const pathMeanCeiling = opts.pathMeanCeiling ?? 0.5;

  const { vertexCount, neighborOffsets, neighbors } = graph;

  const midLums: number[] = [];
  for (let u = 0; u < vertexCount; u++) {
    const begin = neighborOffsets[u];
    const end = neighborOffsets[u + 1];
    for (let i = begin; i < end; i++) {
      const v = neighbors[i];
      if (v <= u) continue;
      midLums.push((luminance[u] + luminance[v]) * 0.5);
    }
  }
  if (midLums.length === 0) return [];
  const sorted = [...midLums].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * darknessPercentile)];
  // Texture has no genuine dark regions — bail out instead of inventing seams.
  if (threshold > absoluteCeiling) return [];

  const darkVertex = new Uint8Array(vertexCount);
  for (let u = 0; u < vertexCount; u++) {
    const begin = neighborOffsets[u];
    const end = neighborOffsets[u + 1];
    for (let i = begin; i < end; i++) {
      const v = neighbors[i];
      const m = (luminance[u] + luminance[v]) * 0.5;
      if (m <= threshold) {
        darkVertex[u] = 1;
        darkVertex[v] = 1;
      }
    }
  }

  const seen = new Uint8Array(vertexCount);
  const paths: number[][] = [];
  for (let v = 0; v < vertexCount; v++) {
    if (!darkVertex[v] || seen[v]) continue;
    const compStack = [v];
    const compNodes: number[] = [];
    seen[v] = 1;
    while (compStack.length > 0) {
      const u = compStack.pop()!;
      compNodes.push(u);
      const begin = neighborOffsets[u];
      const end = neighborOffsets[u + 1];
      for (let i = begin; i < end; i++) {
        const w = neighbors[i];
        if (!darkVertex[w] || seen[w]) continue;
        seen[w] = 1;
        compStack.push(w);
      }
    }
    if (compNodes.length < minPathVertices) continue;
    const a = bfsFarthest(compNodes[0], darkVertex, graph);
    const b = bfsFarthest(a.far, darkVertex, graph);
    const path: number[] = [];
    for (let cur = b.far; cur !== -1; cur = b.parent[cur]) path.push(cur);
    if (path.length < minPathVertices) continue;
    let lumSum = 0;
    for (const v of path) lumSum += luminance[v];
    const meanLum = lumSum / path.length;
    if (meanLum > pathMeanCeiling) continue;
    paths.push(path);
  }

  paths.sort((p, q) => q.length - p.length);
  return paths.slice(0, maxSeams);
}
