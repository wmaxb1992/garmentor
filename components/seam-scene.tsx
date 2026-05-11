"use client";

import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { extractMergedMesh } from "@/lib/glb-mesh";
import {
  buildSeamGraph,
  nearestVertex,
  type SeamGraph,
} from "@/lib/seam-graph";
import type { Seam } from "@/lib/workspace-store";
import { applyFabricToScene, type FabricKey } from "@/lib/fabrics";
import { sampleVertexLuminanceFromSource } from "@/lib/seam-detect";
import { AvatarModel } from "@/components/avatar-model";

export type SeamSceneHandle = {
  graph: SeamGraph | null;
};

export type SeamSceneProps = {
  url: string;
  sourceImageUrl?: string;
  drawMode: boolean;
  inProgressPath: number[];
  inProgressAnchors: number[];
  seams: Seam[];
  fabric?: FabricKey;
  showAvatar?: boolean;
  avatarScale?: number;
  onReady: (graph: SeamGraph, luminance: Float32Array | null) => void;
  onPickVertex: (vertexIndex: number) => void;
};

function pathPoints(graph: SeamGraph, path: number[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const v of path) {
    out.push(
      new THREE.Vector3(
        graph.positions[v * 3],
        graph.positions[v * 3 + 1],
        graph.positions[v * 3 + 2],
      ),
    );
  }
  return out;
}

export function SeamScene({
  url,
  sourceImageUrl,
  drawMode,
  inProgressPath,
  inProgressAnchors,
  seams,
  fabric = "default",
  showAvatar = false,
  avatarScale = 1,
  onReady,
  onPickVertex,
}: SeamSceneProps) {
  const { scene: cachedScene } = useGLTF(url);
  // Clone so material swaps in the workspace don't mutate the chat thumbnail's
  // shared cached scene. Geometry is shared by reference inside clone(true),
  // so this is cheap; only the scene graph and per-mesh material slots are
  // independent.
  const scene = useMemo(() => cachedScene.clone(true), [cachedScene]);
  const groupRef = useRef<THREE.Group>(null);
  const readyRef = useRef(false);
  const originalsRef = useRef<Map<string, THREE.Material | THREE.Material[]>>(
    new Map(),
  );

  const built = useMemo(() => {
    if (!scene) return null;
    const merged = extractMergedMesh(scene);
    if (merged.indices.length === 0) return null;
    const graph = buildSeamGraph(merged.positions, merged.indices);
    return { graph, merged };
  }, [scene]);
  const graph = built?.graph ?? null;

  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [scene]);

  useEffect(() => {
    applyFabricToScene(scene, fabric, originalsRef.current);
  }, [scene, fabric]);

  useEffect(() => {
    if (!built || readyRef.current) return;
    readyRef.current = true;
    // Hunyuan3D-2 GLBs ship without UVs/textures, so we sample the source
    // photo via planar projection instead of reading from the mesh.
    if (sourceImageUrl) {
      let cancelled = false;
      sampleVertexLuminanceFromSource(sourceImageUrl, built.merged).then(
        (lum) => {
          if (!cancelled) onReady(built.graph, lum);
        },
      );
      return () => {
        cancelled = true;
      };
    }
    onReady(built.graph, null);
  }, [built, sourceImageUrl, onReady]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!drawMode || !graph) return;
    event.stopPropagation();
    const p = event.point;
    const v = nearestVertex(graph.positions, p.x, p.y, p.z);
    if (v >= 0) onPickVertex(v);
  };

  const finalizedLines = useMemo(() => {
    if (!graph) return null;
    return seams.map((seam) => {
      const pts = pathPoints(graph, seam.vertexIndices);
      if (pts.length < 2) return null;
      return (
        <Line
          key={seam.id}
          points={pts}
          color="#f97316"
          lineWidth={3}
          depthTest={false}
        />
      );
    });
  }, [graph, seams]);

  const previewLine = useMemo(() => {
    if (!graph || inProgressPath.length < 2) return null;
    const pts = pathPoints(graph, inProgressPath);
    return <Line points={pts} color="#22d3ee" lineWidth={3} depthTest={false} />;
  }, [graph, inProgressPath]);

  const anchorSpheres = useMemo(() => {
    if (!graph) return null;
    const all = new Set<number>();
    for (const s of seams) {
      const ids = s.vertexIndices;
      if (ids.length > 0) {
        all.add(ids[0]);
        all.add(ids[ids.length - 1]);
      }
    }
    for (const v of inProgressAnchors) all.add(v);
    return Array.from(all).map((v) => (
      <mesh
        key={v}
        position={[
          graph.positions[v * 3],
          graph.positions[v * 3 + 1],
          graph.positions[v * 3 + 2],
        ]}
      >
        <sphereGeometry args={[0.012, 12, 12]} />
        <meshBasicMaterial color="#fbbf24" depthTest={false} />
      </mesh>
    ));
  }, [graph, seams, inProgressAnchors]);

  return (
    <group ref={groupRef} onClick={handleClick}>
      <AvatarModel visible={showAvatar} scale={avatarScale} position={[0, -0.4, 0]} />
      <primitive object={scene} />
      {finalizedLines}
      {previewLine}
      {anchorSpheres}
    </group>
  );
}
