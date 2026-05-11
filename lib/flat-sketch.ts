/**
 * Tech-pack flat-sketch SVG renderer.
 *
 * Produces a vector front+back illustration of a garment mesh:
 *   - Silhouette + crease lines from the mesh (lib/mesh-edges).
 *   - User-drawn seam polylines projected into the same view.
 *
 * Output is a self-contained SVG string. No DOM / Three.js dependency.
 */

import { extractFeatureEdges, type FeatureEdge } from "./mesh-edges";

export type FlatView = "front" | "back";
export type SeamLike = { id: string; vertexIndices: number[] };

const PADDING = 24;
const PANEL_WIDTH = 320;

function projectPoint(
  view: FlatView,
  x: number, y: number,
): [number, number] {
  const px = view === "front" ? x : -x;
  const py = -y;
  return [px, py];
}

function viewDir(view: FlatView): [number, number, number] {
  return view === "front" ? [0, 0, 1] : [0, 0, -1];
}

type Projected = {
  pts: Float32Array;
  minX: number; minY: number;
  maxX: number; maxY: number;
};

function projectAll(positions: Float32Array, view: FlatView): Projected {
  const n = positions.length / 3;
  const pts = new Float32Array(n * 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const [x, y] = projectPoint(view, positions[i * 3], positions[i * 3 + 1]);
    pts[i * 2] = x;
    pts[i * 2 + 1] = y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { pts, minX, minY, maxX, maxY };
}

function pathFromEdges(
  edges: FeatureEdge[],
  proj: Projected,
  scale: number, ox: number, oy: number,
  filter: (kind: FeatureEdge["kind"]) => boolean,
): string {
  let d = "";
  for (const e of edges) {
    if (!filter(e.kind)) continue;
    const ax = (proj.pts[e.a * 2] - proj.minX) * scale + ox;
    const ay = (proj.pts[e.a * 2 + 1] - proj.minY) * scale + oy;
    const bx = (proj.pts[e.b * 2] - proj.minX) * scale + ox;
    const by = (proj.pts[e.b * 2 + 1] - proj.minY) * scale + oy;
    d += `M${ax.toFixed(2)} ${ay.toFixed(2)}L${bx.toFixed(2)} ${by.toFixed(2)}`;
  }
  return d;
}

function pathFromSeam(
  seam: SeamLike,
  proj: Projected,
  scale: number, ox: number, oy: number,
): string {
  if (seam.vertexIndices.length < 2) return "";
  let d = "";
  for (let i = 0; i < seam.vertexIndices.length; i++) {
    const v = seam.vertexIndices[i];
    const x = (proj.pts[v * 2] - proj.minX) * scale + ox;
    const y = (proj.pts[v * 2 + 1] - proj.minY) * scale + oy;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

export function renderFlatPanel(
  positions: Float32Array,
  indices: Uint32Array | Uint16Array,
  seams: SeamLike[],
  view: FlatView,
  panelWidth = PANEL_WIDTH,
  panelHeight = PANEL_WIDTH * 1.4,
  xOffset = 0,
): string {
  const proj = projectAll(positions, view);
  const edges = extractFeatureEdges(positions, indices, viewDir(view));

  const meshW = proj.maxX - proj.minX;
  const meshH = proj.maxY - proj.minY;
  const usableW = panelWidth - PADDING * 2;
  const usableH = panelHeight - PADDING * 2 - 16;
  const scale = Math.min(usableW / meshW, usableH / meshH);
  const drawnW = meshW * scale;
  const drawnH = meshH * scale;
  const ox = xOffset + (panelWidth - drawnW) / 2;
  const oy = PADDING + (usableH - drawnH) / 2;

  const silhouettePath = pathFromEdges(
    edges, proj, scale, ox, oy,
    (k) => k === "boundary" || k === "silhouette",
  );
  const creasePath = pathFromEdges(
    edges, proj, scale, ox, oy,
    (k) => k === "crease",
  );
  const seamPaths = seams
    .map((s) => pathFromSeam(s, proj, scale, ox, oy))
    .filter(Boolean);

  const labelY = panelHeight - 6;
  const labelX = xOffset + panelWidth / 2;

  return [
    `<g class="panel-${view}">`,
    creasePath ? `<path d="${creasePath}" fill="none" stroke="#9ca3af" stroke-width="0.6"/>` : "",
    silhouettePath ? `<path d="${silhouettePath}" fill="none" stroke="#111827" stroke-width="1.2" stroke-linecap="round"/>` : "",
    ...seamPaths.map(
      (d) => `<path d="${d}" fill="none" stroke="#f97316" stroke-width="1.4" stroke-dasharray="5,3" stroke-linecap="round"/>`,
    ),
    `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" fill="#374151">${view === "front" ? "FRONT" : "BACK"}</text>`,
    `</g>`,
  ].join("");
}

export function renderFlatSketchSVG(
  positions: Float32Array,
  indices: Uint32Array | Uint16Array,
  seams: SeamLike[],
  panelWidth = PANEL_WIDTH,
): string {
  const panelHeight = panelWidth * 1.4;
  const totalW = panelWidth * 2;
  const front = renderFlatPanel(positions, indices, seams, "front", panelWidth, panelHeight, 0);
  const back = renderFlatPanel(positions, indices, seams, "back", panelWidth, panelHeight, panelWidth);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${panelHeight}" width="${totalW}" height="${panelHeight}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<line x1="${panelWidth}" y1="${PADDING}" x2="${panelWidth}" y2="${panelHeight - PADDING}" stroke="#e5e7eb" stroke-width="0.5"/>`,
    front,
    back,
    `</svg>`,
  ].join("");
}
