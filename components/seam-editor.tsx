"use client";

import { Suspense, useCallback, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Center, Environment, OrbitControls } from "@react-three/drei";
import { SeamScene } from "@/components/seam-scene";
import { shortestPath, type SeamGraph } from "@/lib/seam-graph";
import { useWorkspace, type Model } from "@/lib/workspace-store";
import { cn } from "@/lib/utils";
import {
  FABRIC_ORDER,
  FABRIC_PRESETS,
  type FabricKey,
} from "@/lib/fabrics";
import { detectDarkSeams } from "@/lib/seam-detect";

export function SeamEditor({ model }: { model: Model & { glbUrl: string } }) {
  const { addSeam, removeSeam, clearSeams, state, setViewer } = useWorkspace();
  const { fabric, showAvatar, avatarScale } = state.viewer;
  const [drawMode, setDrawMode] = useState(false);
  const [graph, setGraph] = useState<SeamGraph | null>(null);
  const [luminance, setLuminance] = useState<Float32Array | null>(null);
  const [anchors, setAnchors] = useState<number[]>([]);
  const [path, setPath] = useState<number[]>([]);
  const [autoBusy, setAutoBusy] = useState(false);

  const onReady = useCallback((g: SeamGraph, lum: Float32Array | null) => {
    setGraph(g);
    setLuminance(lum);
  }, []);

  const autoDetect = useCallback(() => {
    if (!graph || !luminance) return;
    setAutoBusy(true);
    // Yield to the browser so the disabled state paints before the heavy work.
    setTimeout(() => {
      try {
        const polylines = detectDarkSeams(graph, luminance);
        for (const p of polylines) addSeam(model.id, p);
      } finally {
        setAutoBusy(false);
      }
    }, 0);
  }, [graph, luminance, addSeam, model.id]);

  const onPickVertex = useCallback(
    (v: number) => {
      if (!graph) return;
      if (anchors.length === 0) {
        setAnchors([v]);
        setPath([v]);
        return;
      }
      const last = anchors[anchors.length - 1];
      if (last === v) return;
      const seg = shortestPath(graph, last, v);
      if (!seg || seg.length < 2) return;
      setAnchors([...anchors, v]);
      setPath([...path, ...seg.slice(1)]);
    },
    [graph, anchors, path],
  );

  const finishSeam = () => {
    if (path.length < 2) return;
    addSeam(model.id, path);
    setAnchors([]);
    setPath([]);
  };

  const cancelSeam = () => {
    setAnchors([]);
    setPath([]);
  };

  const undoAnchor = () => {
    if (anchors.length <= 1) {
      cancelSeam();
      return;
    }
    const newAnchors = anchors.slice(0, -1);
    let rebuilt: number[] = [newAnchors[0]];
    if (graph) {
      for (let i = 1; i < newAnchors.length; i++) {
        const seg = shortestPath(graph, newAnchors[i - 1], newAnchors[i]);
        if (!seg) continue;
        rebuilt = rebuilt.concat(seg.slice(1));
      }
    }
    setAnchors(newAnchors);
    setPath(rebuilt);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white/80 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70">
        <button
          type="button"
          onClick={() => setDrawMode((d) => !d)}
          className={cn(
            "rounded-md border px-3 py-1.5 text-sm font-medium transition",
            drawMode
              ? "border-orange-500 bg-orange-500 text-white"
              : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
          )}
          disabled={!graph}
        >
          {drawMode ? "Drawing" : "Draw seam"}
        </button>
        <button
          type="button"
          onClick={undoAnchor}
          disabled={anchors.length === 0}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-100"
        >
          Undo point
        </button>
        <button
          type="button"
          onClick={finishSeam}
          disabled={path.length < 2}
          className="rounded-md border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Finish seam
        </button>
        <button
          type="button"
          onClick={cancelSeam}
          disabled={anchors.length === 0}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={autoDetect}
          disabled={!graph || !luminance || autoBusy}
          title={
            !luminance
              ? "No baked texture available for this model."
              : "Detect dark seam lines from the texture."
          }
          className="rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {autoBusy ? "Detecting…" : "Auto-detect seams"}
        </button>
        {/* DXF export now lives in the Pattern tab where it has real panels to export. */}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={showAvatar}
              onChange={(e) => setViewer({ showAvatar: e.target.checked })}
              className="rounded"
            />
            Avatar
          </label>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Scale
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.1"
              value={avatarScale}
              onChange={(e) => setViewer({ avatarScale: parseFloat(e.target.value) })}
              disabled={!showAvatar}
              className="w-16"
            />
            <span className="w-8 text-right">{avatarScale.toFixed(1)}</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Fabric
            <select
              value={fabric}
              onChange={(e) => setViewer({ fabric: e.target.value as FabricKey })}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {FABRIC_ORDER.map((key) => (
                <option key={key} value={key}>
                  {FABRIC_PRESETS[key].label}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {model.seams.length} seam{model.seams.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => clearSeams(model.id)}
            disabled={model.seams.length === 0}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-100"
          >
            Clear all
          </button>
        </div>
      </div>

      <div className="relative flex-1 bg-zinc-100 dark:bg-zinc-900">
        <Canvas shadows dpr={[1, 2]} camera={{ position: [2, 1.5, 2.5], fov: 35 }}>
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.2}>
              <Center>
                <SeamScene
                  url={model.glbUrl}
                  sourceImageUrl={model.sourceImageUrl}
                  drawMode={drawMode}
                  inProgressPath={path}
                  inProgressAnchors={anchors}
                  seams={model.seams}
                  fabric={fabric}
                  showAvatar={showAvatar}
                  avatarScale={avatarScale}
                  onReady={onReady}
                  onPickVertex={onPickVertex}
                />
              </Center>
            </Bounds>
            <Environment preset="city" />
          </Suspense>
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        </Canvas>
        {model.seams.length > 0 && (
          <div className="absolute bottom-3 right-3 max-h-48 w-56 overflow-auto rounded-lg border border-zinc-200 bg-white/90 p-2 text-xs shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
            <div className="mb-1 font-medium text-zinc-700 dark:text-zinc-200">
              Seams
            </div>
            <ul className="space-y-1">
              {model.seams.map((s, i) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <span className="text-zinc-600 dark:text-zinc-300">
                    #{i + 1} ({s.vertexIndices.length} pts)
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSeam(model.id, s.id)}
                    className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
