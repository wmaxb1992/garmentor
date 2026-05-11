"use client";

import dynamic from "next/dynamic";
import { Chat } from "@/components/chat";
import { MockupPanel } from "@/components/mockup-panel";
import { WorkspaceProvider } from "@/lib/workspace-store";

const Workspace = dynamic(
  () => import("@/components/workspace").then((m) => m.Workspace),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-zinc-50 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        Loading workspace…
      </div>
    ),
  },
);

export function AppShell() {
  return (
    <WorkspaceProvider>
      <div className="relative flex h-dvh">
        {/* Left side: 3D Model Viewer (full height) */}
        <section className="flex-1 border-r border-zinc-200 dark:border-zinc-800">
          <Workspace />
        </section>

        {/* Right side: Top (mockup) + Bottom (BOM) */}
        <section className="flex w-[45%] flex-col">
          {/* Top right: Mockup image */}
          <div className="flex-1 border-b border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <MockupPanel />
          </div>

          {/* Bottom right: BOM/Measurements */}
          <div className="flex-1 bg-white p-6 dark:bg-zinc-950">
            <div className="h-full overflow-auto rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Bill of Materials
              </h3>
              <div className="space-y-2 text-xs text-zinc-600 dark:text-zinc-400">
                <div className="flex justify-between border-b border-zinc-100 pb-1 dark:border-zinc-800">
                  <span>Chest width:</span>
                  <span className="font-medium">—</span>
                </div>
                <div className="flex justify-between border-b border-zinc-100 pb-1 dark:border-zinc-800">
                  <span>Total length:</span>
                  <span className="font-medium">—</span>
                </div>
                <div className="flex justify-between border-b border-zinc-100 pb-1 dark:border-zinc-800">
                  <span>Sleeve length:</span>
                  <span className="font-medium">—</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Bottom center: Chat box (floating) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-6">
          <div className="pointer-events-auto w-full max-w-3xl">
            <Chat />
          </div>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
