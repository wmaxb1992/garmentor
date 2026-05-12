"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { extractMergedMesh } from "@/lib/glb-mesh";
import { renderFlatSketchSVG } from "@/lib/flat-sketch";
import { measureMesh, fmtCm } from "@/lib/mesh-measure";
import type { Model } from "@/lib/workspace-store";

type SketchData = {
  svg: string;
  measurements: ReturnType<typeof measureMesh>;
};

/** Cache loaded scenes so repeated renders don't re-fetch. */
const sceneCache = new Map<string, THREE.Group>();

function FlatSketchInner({ model }: { model: Model & { glbUrl: string } }) {
  const [scene, setScene] = useState<THREE.Group | null>(
    () => sceneCache.get(model.glbUrl) ?? null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (sceneCache.has(model.glbUrl)) {
      setScene(sceneCache.get(model.glbUrl)!);
      return;
    }
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.load(
      model.glbUrl,
      (gltf) => {
        if (cancelled) return;
        sceneCache.set(model.glbUrl, gltf.scene);
        setScene(gltf.scene);
      },
      undefined,
      (err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => { cancelled = true; };
  }, [model.glbUrl]);

  const data = useMemo<SketchData | null>(() => {
    if (!scene) return null;
    const merged = extractMergedMesh(scene);
    if (merged.indices.length === 0) return null;
    const svg = renderFlatSketchSVG(merged.positions, merged.indices, model.seams, 360);
    const measurements = measureMesh(merged.positions);
    return { svg, measurements };
  }, [scene, model.seams]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-500">
        Failed to load model: {loadError}
      </div>
    );
  }

  if (!scene) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading model…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Mesh has no triangles.
      </div>
    );
  }

  const downloadSvg = () => {
    const blob = new Blob([data.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${model.id}-flat-sketch.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const m = data.measurements;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70">
        <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Tech-pack flat sketch
        </div>
        <div className="ml-auto">
          <button
            type="button"
            onClick={downloadSvg}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Export SVG
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <div
          className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-white p-3 shadow-inner dark:border-zinc-800 dark:bg-zinc-100"
          dangerouslySetInnerHTML={{ __html: data.svg }}
        />
        <aside className="w-44 shrink-0 space-y-3 text-xs">
          <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Measurements
            </div>
            <dl className="space-y-1.5">
              <Row label="Length" value={fmtCm(m.totalLength)} />
              <Row label="Width" value={fmtCm(m.width)} />
              <Row label="Depth" value={fmtCm(m.depth)} />
              <Row label="Chest girth" value={fmtCm(m.chestGirth)} />
            </dl>
            <p className="mt-3 text-[10px] leading-snug text-zinc-400">
              Estimated from the 3D mesh. Auto-only; not editable in this phase.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Seams
            </div>
            <div className="text-zinc-700 dark:text-zinc-300">
              {model.seams.length} drawn
            </div>
            <p className="mt-2 text-[10px] leading-snug text-zinc-400">
              Drawn seams appear as dashed orange lines on both views.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="font-medium text-zinc-800 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

export function FlatSketch({ model }: { model: Model & { glbUrl: string } }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
          Building flat sketch…
        </div>
      }
    >
      <FlatSketchInner key={model.id} model={model} />
    </Suspense>
  );
}
