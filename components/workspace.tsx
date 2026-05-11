"use client";

import { useState } from "react";
import { FlatSketch } from "@/components/flat-sketch";
import { PatternViewer } from "@/components/pattern-viewer";
import { SeamEditor } from "@/components/seam-editor";
import { ProjectControls } from "@/components/project-controls";
import { cn } from "@/lib/utils";
import { useActiveModel, useWorkspace } from "@/lib/workspace-store";

type WorkspaceTab = "pattern" | "seams" | "sketch";

export function Workspace() {
  const { state, setActive } = useWorkspace();
  const active = useActiveModel();
  const [tab, setTab] = useState<WorkspaceTab>("pattern");
  const allModels = Object.values(state.models).sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  const modelLabel = (m: { description?: string; glbUrl?: string; gcdUrl?: string }) =>
    m.description ?? m.glbUrl?.split("/").pop() ?? m.gcdUrl?.split("/").pop() ?? "untitled";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <ProjectControls />
        {allModels.length > 0 && (
          <>
            <div className="h-4 w-px bg-zinc-300 dark:bg-zinc-700" />
            <select
              value={active?.id ?? ""}
              onChange={(e) => setActive(e.target.value || null)}
              className="min-w-0 flex-1 truncate rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">Select a model...</option>
              {allModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {modelLabel(m)}
                </option>
              ))}
            </select>
          </>
        )}
        {active && (
          <div className="flex items-center gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-900">
            <TabPill active={tab === "pattern"} onClick={() => setTab("pattern")}>
              Pattern
            </TabPill>
            <TabPill
              active={tab === "seams"}
              onClick={() => setTab("seams")}
              disabled={!active.glbUrl}
            >
              Seam editor
            </TabPill>
            <TabPill
              active={tab === "sketch"}
              onClick={() => setTab("sketch")}
              disabled={!active.glbUrl}
            >
              Flat sketch
            </TabPill>
          </div>
        )}
      </div>
      {!active ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 p-8 text-center text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <div className="text-base font-medium text-zinc-700 dark:text-zinc-200">
            No active model
          </div>
          <p className="max-w-sm">
            Attach a garment photo in chat and ask the assistant to generate a
            pattern or a 3D preview.
          </p>
          {allModels.length > 0 && (
            <div className="mt-4 w-full max-w-md">
              <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">
                Recent models
              </div>
              <ul className="space-y-1 text-left">
                {allModels.slice(0, 8).map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setActive(m.id)}
                      className="w-full truncate rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      {modelLabel(m)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          {tab === "pattern" ? (
            <PatternViewer key={active.id} />
          ) : tab === "seams" && active.glbUrl ? (
            <SeamEditor key={active.id} model={{ ...active, glbUrl: active.glbUrl }} />
          ) : tab === "sketch" && active.glbUrl ? (
            <FlatSketch key={active.id} model={{ ...active, glbUrl: active.glbUrl }} />
          ) : (
            <div className="flex h-full items-center justify-center bg-zinc-50 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              No 3D mesh for this item — generate one to use this view.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabPill({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}
