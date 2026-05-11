"use client";

import { useState } from "react";
import { FlatSketch } from "@/components/flat-sketch";
import { SeamEditor } from "@/components/seam-editor";
import { cn } from "@/lib/utils";
import { useActiveModel, useWorkspace } from "@/lib/workspace-store";

type WorkspaceTab = "seams" | "sketch";

export function Workspace() {
  const { state, setActive } = useWorkspace();
  const active = useActiveModel();
  const [tab, setTab] = useState<WorkspaceTab>("seams");
  const allModels = Object.values(state.models).sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-50 p-8 text-center text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        <div className="text-base font-medium text-zinc-700 dark:text-zinc-200">
          No active model
        </div>
        <p className="max-w-sm">
          Generate a 3D model in chat or click <span className="font-medium">Set as active</span>
          {" "}on a previous result to start drawing seams here.
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
                    {m.description ?? m.glbUrl.split("/").pop()}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
            {active.description ?? "3D model"}
          </div>
          <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {active.glbUrl.split("/").pop()}
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-900">
          <TabPill active={tab === "seams"} onClick={() => setTab("seams")}>
            Seam editor
          </TabPill>
          <TabPill active={tab === "sketch"} onClick={() => setTab("sketch")}>
            Flat sketch
          </TabPill>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === "seams" ? (
          <SeamEditor key={active.id} model={active} />
        ) : (
          <FlatSketch key={active.id} model={active} />
        )}
      </div>
    </div>
  );
}

function TabPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2.5 py-1 text-xs font-medium transition",
        active
          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}
