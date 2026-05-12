/**
 * Extract a merged, world-space triangle mesh from a loaded GLTF scene.
 *
 * Walks every visible Mesh in the scene graph, applies each mesh's world
 * matrix to its vertex positions, generates a sequential index buffer for
 * any non-indexed geometry, and concatenates everything into a single
 * Float32Array of positions and Uint32Array of triangle indices.
 *
 * Output is suitable as input to lib/seam-graph.ts.
 */

import type { Object3D } from "three";
import { BufferGeometry, Matrix4, Mesh, Vector3 } from "three";

export type MergedMesh = {
  positions: Float32Array;
  indices: Uint32Array;
  meshSourceIds: number[];
  /** Per-vertex UV (length = vertexCount * 2). null if any source mesh lacks UVs. */
  uvs: Float32Array | null;
  /** Per-vertex index into meshSourceIds — which submesh the vertex came from. */
  vertexMeshSlot: Uint32Array;
  /** Area-weighted per-vertex normals in world space (length = vertexCount * 3). */
  normals: Float32Array;
};

function computeVertexNormals(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const ax1 = positions[ia], ay1 = positions[ia + 1], az1 = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const ex = bx - ax1, ey = by - ay1, ez = bz - az1;
    const fx = cx - ax1, fy = cy - ay1, fz = cz - az1;
    // cross(e,f) gives an area-weighted normal (length = 2*triArea).
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }
  for (let v = 0; v < normals.length; v += 3) {
    const x = normals[v], y = normals[v + 1], z = normals[v + 2];
    const len = Math.hypot(x, y, z);
    if (len > 1e-12) {
      normals[v] = x / len;
      normals[v + 1] = y / len;
      normals[v + 2] = z / len;
    }
  }
  return normals;
}

function collectMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj instanceof Mesh && obj.visible) {
      const geom = obj.geometry as BufferGeometry | undefined;
      if (geom && geom.getAttribute("position")) out.push(obj);
    }
  });
  return out;
}

/**
 * Returns the same Mesh list as the internal traversal used by
 * extractMergedMesh, in the same order. Use alongside MergedMesh.meshSourceIds
 * (and vertexMeshSlot) to look up textures or materials per vertex.
 */
export function collectMergedMeshes(root: Object3D): Mesh[] {
  return collectMeshes(root);
}

export function extractMergedMesh(root: Object3D): MergedMesh {
  const meshes = collectMeshes(root);

  let totalVerts = 0;
  let totalTris = 0;
  let allHaveUvs = meshes.length > 0;
  for (const m of meshes) {
    const g = m.geometry as BufferGeometry;
    const posAttr = g.getAttribute("position");
    totalVerts += posAttr.count;
    const idx = g.getIndex();
    totalTris += idx ? idx.count / 3 : posAttr.count / 3;
    if (!g.getAttribute("uv")) allHaveUvs = false;
  }

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalTris * 3);
  const meshSourceIds: number[] = [];
  const vertexMeshSlot = new Uint32Array(totalVerts);
  const uvs = allHaveUvs ? new Float32Array(totalVerts * 2) : null;

  let vOffset = 0;
  let iOffset = 0;
  const tmp = new Vector3();
  const mat = new Matrix4();

  for (let slot = 0; slot < meshes.length; slot++) {
    const mesh = meshes[slot];
    const g = mesh.geometry as BufferGeometry;
    const posAttr = g.getAttribute("position");
    const uvAttr = uvs ? g.getAttribute("uv") : null;
    const vCount = posAttr.count;
    mat.copy(mesh.matrixWorld);

    for (let i = 0; i < vCount; i++) {
      tmp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      tmp.applyMatrix4(mat);
      positions[(vOffset + i) * 3] = tmp.x;
      positions[(vOffset + i) * 3 + 1] = tmp.y;
      positions[(vOffset + i) * 3 + 2] = tmp.z;
      vertexMeshSlot[vOffset + i] = slot;
      if (uvs && uvAttr) {
        uvs[(vOffset + i) * 2] = uvAttr.getX(i);
        uvs[(vOffset + i) * 2 + 1] = uvAttr.getY(i);
      }
    }

    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices[iOffset + i] = idx.getX(i) + vOffset;
      }
      iOffset += idx.count;
    } else {
      for (let i = 0; i < vCount; i++) {
        indices[iOffset + i] = vOffset + i;
      }
      iOffset += vCount;
    }

    meshSourceIds.push(mesh.id);
    vOffset += vCount;
  }

  const normals = computeVertexNormals(positions, indices);
  return { positions, indices, meshSourceIds, uvs, vertexMeshSlot, normals };
}
