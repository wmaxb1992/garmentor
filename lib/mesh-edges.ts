/**
 * Silhouette + crease edge extraction for tech-pack flat-sketch rendering.
 *
 * Given a merged mesh and a view direction, returns the subset of mesh
 * edges that should appear in a 2D line drawing:
 *
 *   - Boundary edges (only one adjacent triangle) — always kept.
 *   - Silhouette edges — adjacent triangles disagree on whether they face
 *     the camera (one front-facing, one back-facing).
 *   - Crease edges — dihedral angle between adjacent triangles exceeds
 *     `thresholdAngle` (radians).
 *
 * All other edges are dropped to keep the SVG legible.
 */

export type EdgeKind = "boundary" | "silhouette" | "crease";

export type FeatureEdge = {
  a: number;
  b: number;
  kind: EdgeKind;
};

type EdgeRecord = { a: number; b: number; faces: number[] };

function edgeKey(a: number, b: number, vertexCount: number): number {
  return a < b ? a * vertexCount + b : b * vertexCount + a;
}

type FaceInfo = {
  nx: number; ny: number; nz: number;
  viewDot: number;
};

function computeFaceInfo(
  positions: Float32Array,
  indices: Uint32Array | Uint16Array,
  vx: number, vy: number, vz: number,
): FaceInfo[] {
  const triCount = indices.length / 3;
  const out: FaceInfo[] = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;
    out[t] = { nx, ny, nz, viewDot: nx * vx + ny * vy + nz * vz };
  }
  return out;
}

export function extractFeatureEdges(
  positions: Float32Array,
  indices: Uint32Array | Uint16Array,
  viewDir: [number, number, number],
  thresholdAngle: number = (25 * Math.PI) / 180,
): FeatureEdge[] {
  const [vx, vy, vz] = viewDir;
  const faces = computeFaceInfo(positions, indices, vx, vy, vz);

  const vertexCount = positions.length / 3;
  const edges = new Map<number, EdgeRecord>();
  const triCount = indices.length / 3;
  const addEdge = (u: number, v: number, t: number) => {
    const k = edgeKey(u, v, vertexCount);
    const cur = edges.get(k);
    if (cur) cur.faces.push(t);
    else edges.set(k, { a: u < v ? u : v, b: u < v ? v : u, faces: [t] });
  };
  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    addEdge(ia, ib, t);
    addEdge(ib, ic, t);
    addEdge(ic, ia, t);
  }

  const cosThresh = Math.cos(thresholdAngle);
  const out: FeatureEdge[] = [];

  for (const rec of edges.values()) {
    const { a, b, faces: faceList } = rec;
    if (faceList.length === 1) {
      out.push({ a, b, kind: "boundary" });
      continue;
    }
    if (faceList.length !== 2) continue;

    const f0 = faces[faceList[0]];
    const f1 = faces[faceList[1]];
    const front0 = f0.viewDot > 0;
    const front1 = f1.viewDot > 0;
    if (front0 !== front1) {
      out.push({ a, b, kind: "silhouette" });
      continue;
    }
    if (!front0) continue;

    const dot = f0.nx * f1.nx + f0.ny * f1.ny + f0.nz * f1.nz;
    if (dot < cosThresh) {
      out.push({ a, b, kind: "crease" });
    }
  }

  return out;
}
