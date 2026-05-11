import * as THREE from "three";

// Procedural PBR fabric presets. No texture assets — pure parameter-driven
// MeshPhysicalMaterial so the bundle stays small and there is nothing to fetch.
// `build` is omitted on `default` to mean "leave the GLB's baked material
// alone" — consumers should restore the original material in that case.

export type FabricKey =
  | "default"
  | "cotton"
  | "denim"
  | "leather"
  | "silk"
  | "wool"
  | "linen";

export type FabricPreset = {
  label: string;
  build?: () => THREE.Material;
};

export const FABRIC_PRESETS: Record<FabricKey, FabricPreset> = {
  default: { label: "Original" },
  cotton: {
    label: "Cotton",
    build: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xeae6df,
        roughness: 0.85,
        metalness: 0.0,
        sheen: 0.4,
        sheenRoughness: 0.6,
        sheenColor: new THREE.Color(0xffffff),
      }),
  },
  denim: {
    label: "Denim",
    build: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x2a4d6e,
        roughness: 0.95,
        metalness: 0.0,
        sheen: 0.25,
        sheenRoughness: 0.9,
        sheenColor: new THREE.Color(0x9eb0c2),
      }),
  },
  leather: {
    label: "Leather",
    build: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x3a2418,
        roughness: 0.45,
        metalness: 0.05,
        clearcoat: 0.25,
        clearcoatRoughness: 0.6,
      }),
  },
  silk: {
    label: "Silk",
    build: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xede4c8,
        roughness: 0.25,
        metalness: 0.0,
        sheen: 1.0,
        sheenRoughness: 0.2,
        sheenColor: new THREE.Color(0xffffff),
      }),
  },
  wool: {
    label: "Wool",
    build: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x7a7268,
        roughness: 1.0,
        metalness: 0.0,
        sheen: 0.1,
        sheenRoughness: 1.0,
      }),
  },
  linen: {
    label: "Linen",
    build: () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xd9cfb6,
        roughness: 0.9,
        metalness: 0.0,
        sheen: 0.3,
        sheenRoughness: 0.7,
        sheenColor: new THREE.Color(0xfff7e0),
      }),
  },
};

export const FABRIC_ORDER: FabricKey[] = [
  "default",
  "cotton",
  "denim",
  "leather",
  "silk",
  "wool",
  "linen",
];

// Save-and-swap helper. `originals` is a Map keyed by mesh.uuid that retains
// each mesh's original material so we can restore it when the user switches
// back to "default". Caller should construct one Map per scene instance and
// keep it alive for the lifetime of the component.
export function applyFabricToScene(
  scene: THREE.Object3D,
  fabric: FabricKey,
  originals: Map<string, THREE.Material | THREE.Material[]>,
): void {
  const preset = FABRIC_PRESETS[fabric];
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (!originals.has(obj.uuid)) {
      originals.set(obj.uuid, obj.material);
    }
    const original = originals.get(obj.uuid)!;
    const current = obj.material as THREE.Material | THREE.Material[];
    if (current !== original && !Array.isArray(current)) {
      current.dispose();
    }
    obj.material = preset.build ? preset.build() : original;
  });
}

export function restoreOriginalMaterials(
  scene: THREE.Object3D,
  originals: Map<string, THREE.Material | THREE.Material[]>,
): void {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const original = originals.get(obj.uuid);
    if (!original) return;
    const current = obj.material as THREE.Material | THREE.Material[];
    if (current !== original && !Array.isArray(current)) {
      current.dispose();
    }
    obj.material = original;
  });
}
