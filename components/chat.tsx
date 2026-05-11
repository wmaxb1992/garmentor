"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { ChatInput } from "@/components/chat-input";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-store";

const GlbViewer = dynamic(
  () => import("@/components/glb-viewer").then((m) => m.GlbViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[380px] w-full items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        Loading 3D viewer…
      </div>
    ),
  },
);

type Generate3dToolOutput =
  | {
      ok: true;
      glbUrl: string;
      id: string;
      bytes: number;
      description: string;
      sourceImageUrl?: string;
    }
  | { ok: false; error: string };

type EditImageToolOutput =
  | { ok: true; imageUrl: string; id: string; bytes: number; instruction: string }
  | { ok: false; error: string };

export function Chat() {
  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
      {/* Messages area */}
      <div 
        ref={scrollRef} 
        className="max-h-[400px] min-h-[120px] overflow-y-auto"
      >
        {isEmpty ? (
          <div className="flex items-center justify-center p-8 text-center">
            <div>
              <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Garmentor
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Attach a photo to generate a 3D model
              </p>
            </div>
          </div>
        ) : (
          <div className="px-4 py-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "mb-4 flex gap-3",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] space-y-3 rounded-xl px-3 py-2 text-sm leading-relaxed",
                    message.role === "user"
                      ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100",
                  )}
                >
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      return (
                        <p key={i} className="whitespace-pre-wrap">
                          {part.text}
                        </p>
                      );
                    }
                    if (
                      part.type === "file" &&
                      part.mediaType?.startsWith("image/")
                    ) {
                      return (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={part.url}
                          alt={part.filename ?? "attachment"}
                          className="max-h-48 rounded-lg object-contain"
                        />
                      );
                    }
                    if (part.type === "tool-generate_3d_model") {
                      return (
                        <ToolPart
                          key={i}
                          state={part.state}
                          output={part.output as Generate3dToolOutput | undefined}
                        />
                      );
                    }
                    if (part.type === "tool-edit_garment_image") {
                      return (
                        <EditToolPart
                          key={i}
                          state={part.state}
                          output={part.output as EditImageToolOutput | undefined}
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}
            {status === "submitted" && (
              <div className="mb-4 flex justify-start">
                <div className="rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-900">
                  Thinking…
                </div>
              </div>
            )}
            {error && (
              <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {error.message}
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Input area */}
      <div className="border-t border-zinc-200 dark:border-zinc-800">
        <ChatInput
          status={status}
          onStop={stop}
          onSubmit={({ text, files }) => sendMessage({ text, files })}
        />
      </div>
    </div>
  );

}

function ToolPart({
  state,
  output,
}: {
  state: string;
  output?: Generate3dToolOutput;
}) {
  const { setGenerating } = useWorkspace();

  useEffect(() => {
    if (state === "input-streaming" || state === "input-available") {
      setGenerating(true);
    } else {
      setGenerating(false);
    }
  }, [state, setGenerating]);

  if (state === "input-streaming" || state === "input-available") {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white/50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40">
        Generating 3D model… this can take 30–60s on a cold GPU.
      </div>
    );
  }
  if (state === "output-available" && output) {
    if (!output.ok) {
      return (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {output.error}
        </div>
      );
    }
    return <ToolResult output={output} />;
  }
  if (state === "output-error") {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        Tool failed.
      </div>
    );
  }
  return null;
}

function ToolResult({
  output,
}: {
  output: Extract<Generate3dToolOutput, { ok: true }>;
}) {
  const { state, addModel, setActive } = useWorkspace();
  const isActive = state.activeModelId === output.id;

  useEffect(() => {
    addModel({
      id: output.id,
      glbUrl: output.glbUrl,
      bytes: output.bytes,
      description: output.description,
      sourceImageUrl: output.sourceImageUrl,
    });
  }, [
    output.id,
    output.glbUrl,
    output.bytes,
    output.description,
    output.sourceImageUrl,
    addModel,
  ]);

  return (
    <div className="space-y-2">
      <GlbViewer url={output.glbUrl} height={220} />
      <div className="flex items-center justify-between gap-3">
        <a
          href={output.glbUrl}
          download
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Download .glb ({Math.round(output.bytes / 1024)} KB)
        </a>
        <button
          type="button"
          onClick={() => setActive(output.id)}
          disabled={isActive}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium transition",
            isActive
              ? "border-emerald-600 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
              : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900",
          )}
        >
          {isActive ? "Active in workspace" : "Set as active"}
        </button>
      </div>
    </div>
  );
}

function EditToolPart({
  state,
  output,
}: {
  state: string;
  output?: EditImageToolOutput;
}) {
  const { setEditing } = useWorkspace();

  useEffect(() => {
    if (state === "input-streaming" || state === "input-available") {
      setEditing(true);
    } else {
      setEditing(false);
    }
  }, [state, setEditing]);

  if (state === "input-streaming" || state === "input-available") {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white/50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40">
        Editing the garment image… this can take 60–90s on a cold GPU.
      </div>
    );
  }
  if (state === "output-available" && output) {
    if (!output.ok) {
      return (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {output.error}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={output.imageUrl}
          alt={output.instruction}
          className="max-h-80 rounded-lg border border-zinc-200 object-contain dark:border-zinc-800"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {output.instruction}
          </span>
          <a
            href={output.imageUrl}
            download
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Download ({Math.round(output.bytes / 1024)} KB)
          </a>
        </div>
      </div>
    );
  }
  if (state === "output-error") {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        Tool failed.
      </div>
    );
  }
  return null;
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Garmentor</h1>
      <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        Attach a photo and ask for a 3D model, or describe a design change to
        get an edited mockup. Seam drawing happens in the workspace pane on the
        right.
      </p>
    </div>
  );
}
