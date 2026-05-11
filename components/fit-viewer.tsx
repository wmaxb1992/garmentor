"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Center, Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { useActiveModel } from "@/lib/workspace-store";

function DrapedGarment({ url }: { url: string }) {
  const gltf = useGLTF(url) as unknown as { scene: import("three").Group };
  return <primitive object={gltf.scene} />;
}

function metricsColor(maxStretch: number, maxCompression: number): string {
  if (maxStretch > 1.15) return "#dc2626"; // red — pulling
  if (maxCompression < 0.85) return "#2563eb"; // blue — excess
  return "#16a34a"; // green — good
}

export function FitViewer() {
  const active = useActiveModel();

  if (!active?.drapedGlbUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-50 p-8 text-center text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        <div>
          <div className="text-base font-medium text-zinc-700 dark:text-zinc-200">
            No drape simulation yet
          </div>
          <p className="mt-1 max-w-sm">
            Ask the assistant to "drape this pattern" — the cloth simulator
            stitches the panels and drapes them on an avatar.
          </p>
        </div>
      </div>
    );
  }

  const m = active.drapeMetrics;
  const verdictColor = m ? metricsColor(m.maxStretch, m.maxCompression) : "#888";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Drape simulation
        </span>
        {m && (
          <div className="flex gap-4 text-xs">
            <Metric label="max stretch" value={m.maxStretch.toFixed(2)} color={m.maxStretch > 1.15 ? "#dc2626" : "#71717a"} />
            <Metric label="max compression" value={m.maxCompression.toFixed(2)} color={m.maxCompression < 0.85 ? "#2563eb" : "#71717a"} />
            <Metric label="mean stretch" value={m.meanStretch.toFixed(2)} color="#71717a" />
            <div
              className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium text-white"
              style={{ background: verdictColor }}
            >
              {m.maxStretch > 1.15
                ? "pulling — panels too small"
                : m.maxCompression < 0.85
                ? "excess fabric — panels too big"
                : "good fit"}
            </div>
          </div>
        )}
        <a
          href={active.drapedGlbUrl}
          download
          className="ml-auto text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Download draped GLB
        </a>
      </div>
      <div className="flex-1 bg-zinc-100 dark:bg-zinc-900">
        <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 0.5, 2.5], fov: 35 }}>
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.2}>
              <Center>
                <DrapedGarment url={active.drapedGlbUrl} />
              </Center>
            </Bounds>
            <Environment preset="city" />
          </Suspense>
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        </Canvas>
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-medium" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
