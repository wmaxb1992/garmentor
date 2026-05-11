/**
 * Edge-graph for vertex-snapped geodesic seams on a triangle mesh.
 *
 * - Builds CSR adjacency from indexed triangles, deduplicating undirected edges
 *   shared between adjacent faces.
 * - Dijkstra shortest path between two vertices weighted by edge length.
 *
 * Pure TS; no Three.js dependency. Inputs come from lib/glb-mesh.ts.
 */

export type SeamGraph = {
  vertexCount: number;
  positions: Float32Array;
  neighborOffsets: Uint32Array;
  neighbors: Uint32Array;
  neighborWeights: Float32Array;
};

export function buildSeamGraph(
  positions: Float32Array,
  indices: Uint32Array | Uint16Array,
): SeamGraph {
  const vertexCount = positions.length / 3;
  const triCount = indices.length / 3;

  const neighborSet: Array<Set<number>> = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) neighborSet[i] = new Set();

  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    neighborSet[a].add(b); neighborSet[b].add(a);
    neighborSet[b].add(c); neighborSet[c].add(b);
    neighborSet[c].add(a); neighborSet[a].add(c);
  }

  let edgeCount = 0;
  const neighborOffsets = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v++) {
    neighborOffsets[v] = edgeCount;
    edgeCount += neighborSet[v].size;
  }
  neighborOffsets[vertexCount] = edgeCount;

  const neighbors = new Uint32Array(edgeCount);
  const neighborWeights = new Float32Array(edgeCount);

  for (let v = 0; v < vertexCount; v++) {
    let i = neighborOffsets[v];
    const vx = positions[v * 3];
    const vy = positions[v * 3 + 1];
    const vz = positions[v * 3 + 2];
    for (const n of neighborSet[v]) {
      neighbors[i] = n;
      const dx = positions[n * 3] - vx;
      const dy = positions[n * 3 + 1] - vy;
      const dz = positions[n * 3 + 2] - vz;
      neighborWeights[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      i++;
    }
  }

  return { vertexCount, positions, neighborOffsets, neighbors, neighborWeights };
}

class MinHeap {
  private keys: number[] = [];
  private values: Float32Array = new Float32Array(64);
  private size = 0;

  push(key: number, value: number) {
    if (this.size >= this.values.length) {
      const grown = new Float32Array(this.values.length * 2);
      grown.set(this.values);
      this.values = grown;
    }
    this.keys[this.size] = key;
    this.values[this.size] = value;
    this.size++;
    this.bubbleUp(this.size - 1);
  }

  pop(): { key: number; value: number } | null {
    if (this.size === 0) return null;
    const top = { key: this.keys[0], value: this.values[0] };
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.values[0] = this.values[this.size];
      this.sinkDown(0);
    }
    return top;
  }

  get length() { return this.size; }

  private bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.values[parent] <= this.values[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private sinkDown(i: number) {
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < this.size && this.values[left] < this.values[smallest]) smallest = left;
      if (right < this.size && this.values[right] < this.values[smallest]) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(a: number, b: number) {
    const tk = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = tk;
    const tv = this.values[a]; this.values[a] = this.values[b]; this.values[b] = tv;
  }
}

/**
 * Dijkstra shortest path on the edge graph from `start` to `goal`.
 * Returns the vertex-index path inclusive of both endpoints, or null if
 * unreachable. Both endpoints are returned even when start === goal.
 */
export function shortestPath(
  graph: SeamGraph,
  start: number,
  goal: number,
): number[] | null {
  const { vertexCount, neighborOffsets, neighbors, neighborWeights } = graph;
  if (start < 0 || start >= vertexCount || goal < 0 || goal >= vertexCount) {
    return null;
  }
  if (start === goal) return [start];

  const dist = new Float32Array(vertexCount);
  const prev = new Int32Array(vertexCount);
  const visited = new Uint8Array(vertexCount);
  dist.fill(Infinity);
  prev.fill(-1);
  dist[start] = 0;

  const heap = new MinHeap();
  heap.push(start, 0);

  while (heap.length > 0) {
    const top = heap.pop()!;
    const u = top.key;
    if (visited[u]) continue;
    visited[u] = 1;
    if (u === goal) break;
    const begin = neighborOffsets[u];
    const end = neighborOffsets[u + 1];
    const du = dist[u];
    for (let i = begin; i < end; i++) {
      const v = neighbors[i];
      if (visited[v]) continue;
      const alt = du + neighborWeights[i];
      if (alt < dist[v]) {
        dist[v] = alt;
        prev[v] = u;
        heap.push(v, alt);
      }
    }
  }

  if (dist[goal] === Infinity) return null;

  const path: number[] = [];
  for (let v = goal; v !== -1; v = prev[v]) path.push(v);
  path.reverse();
  return path;
}

/**
 * Find the nearest vertex index to a 3D point. Linear scan; fine up to ~1M
 * vertices on modern hardware (~5ms). Replace with a KD-tree if profiling
 * shows it's hot.
 */
export function nearestVertex(
  positions: Float32Array,
  px: number, py: number, pz: number,
): number {
  let best = -1;
  let bestD2 = Infinity;
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3] - px;
    const dy = positions[i * 3 + 1] - py;
    const dz = positions[i * 3 + 2] - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}
