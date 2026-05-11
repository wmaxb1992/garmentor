"use client";

import dynamic from "next/dynamic";
import { BomPanel } from "@/components/bom-panel";
import { Chat } from "@/components/chat";
import { MockupPanel } from "@/components/mockup-panel";
import { PasswordGate } from "@/components/password-gate";
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
    <PasswordGate>
      <WorkspaceProvider>
        <div className="relative flex h-dvh">
          <section className="flex-1 border-r border-zinc-200 dark:border-zinc-800">
            <Workspace />
          </section>

          <section className="flex w-[45%] flex-col">
            <div className="flex-1 border-b border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <MockupPanel />
            </div>
            <div className="flex-1 bg-white p-6 dark:bg-zinc-950">
              <BomPanel />
            </div>
          </section>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-6">
            <div className="pointer-events-auto w-full max-w-3xl">
              <Chat />
            </div>
          </div>
        </div>
      </WorkspaceProvider>
    </PasswordGate>
  );
}
