/**
 * Auto-extracted garment measurements from a merged mesh.
 *
 * All helpers are pure TS; they read the same Float32Array positions
 * produced by lib/glb-mesh.ts. Y is treated as the vertical (height) axis
 * by Hunyuan3D-2 convention.
 *
 * Outputs are in mesh-space units (meters by GLTF convention). Convert to
 * cm for display.
 */

export type BBox = {
  min: [number, number, number];
  max: [number, number, number];
};

export type Measurements = {
  bbox: BBox;
  totalLength: number;
  width: number;
  depth: number;
  chestGirth: number;
  chestY: number;
};

export function boundingBox(positions: Float32Array): BBox {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

type Pt2 = [number, number];

function convexHull2D(pts: Pt2[]): Pt2[] {
  if (pts.length < 3) return pts.slice();
  const sorted = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt2, a: Pt2, b: Pt2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt2[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function hullPerimeter(hull: Pt2[]): number {
  if (hull.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    p += Math.sqrt(dx * dx + dy * dy);
  }
  return p;
}

const SLICE_COUNT = 48;

export function measureMesh(positions: Float32Array): Measurements {
  const bbox = boundingBox(positions);
  const totalLength = bbox.max[1] - bbox.min[1];
  const width = bbox.max[0] - bbox.min[0];
  const depth = bbox.max[2] - bbox.min[2];

  const sliceThickness = totalLength / SLICE_COUNT;
  const halfThickness = sliceThickness * 0.6;
  const n = positions.length / 3;

  let maxPerim = 0;
  let bestY = bbox.min[1];

  for (let s = 0; s < SLICE_COUNT; s++) {
    const y = bbox.min[1] + (s + 0.5) * sliceThickness;
    const slice: Pt2[] = [];
    for (let i = 0; i < n; i++) {
      const py = positions[i * 3 + 1];
      if (Math.abs(py - y) <= halfThickness) {
        slice.push([positions[i * 3], positions[i * 3 + 2]]);
      }
    }
    if (slice.length < 3) continue;
    const hull = convexHull2D(slice);
    const perim = hullPerimeter(hull);
    if (perim > maxPerim) {
      maxPerim = perim;
      bestY = y;
    }
  }

  return {
    bbox,
    totalLength,
    width,
    depth,
    chestGirth: maxPerim,
    chestY: bestY,
  };
}

/** Convert mesh-space units (meters) to centimeters for display. */
export function toCm(meters: number): number {
  return meters * 100;
}

/** Format a measurement as "NN.N cm". */
export function fmtCm(meters: number): string {
  return `${toCm(meters).toFixed(1)} cm`;
}
