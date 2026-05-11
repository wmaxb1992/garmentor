"use client";

import { useActiveModel, useWorkspace } from "@/lib/workspace-store";

export function MockupPanel() {
  const active = useActiveModel();
  const { state } = useWorkspace();
  const isProcessing = state.isGenerating || state.isEditing;
  const previewUrl = active?.sourceImageUrl ?? state.pendingImageUrl ?? null;

  if (!previewUrl && !isProcessing) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700">
        <div className="text-center">
          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Mockup image
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Attach a garment photo in chat to get started
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col gap-3">
      <div className="flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {previewUrl ? (
          <div className="relative h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Source garment"
              className="h-full w-full object-contain"
              style={{
                opacity: isProcessing ? 0.5 : 1,
                transition: "opacity 0.3s ease",
              }}
            />
            {isProcessing && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-zinc-950/70">
                <div className="text-center text-sm text-zinc-700 dark:text-zinc-200">
                  {state.isEditing ? "Editing image…" : "Generating…"}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            Processing image…
          </div>
        )}
      </div>
      {active?.description && (
        <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          {active.description}
        </div>
      )}
    </div>
  );
}
