"use client";

import { useRef, useState } from "react";
import { ImageIcon, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-store";

export type ChatInputProps = {
  disabled?: boolean;
  onSubmit: (args: { text: string; files?: FileList }) => void;
  onStop?: () => void;
  status: "submitted" | "streaming" | "ready" | "error";
};

export function ChatInput({ disabled, onSubmit, onStop, status }: ChatInputProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileList | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const { setPendingImage } = useWorkspace();

  const isBusy = status === "submitted" || status === "streaming";

  const onFiles = async (next: FileList | null) => {
    if (!next || next.length === 0) {
      setFiles(undefined);
      setPreviewUrl(null);
      setPendingImage(null, null);
      return;
    }
    setFiles(next);
    const f = next[0];
    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreviewUrl(url);
      
      // Read file as bytes and set in workspace
      const arrayBuffer = await f.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      setPendingImage(url, { bytes, mediaType: f.type });
    } else {
      setPreviewUrl(null);
    }
  };

  const clearFile = () => {
    setFiles(undefined);
    setPreviewUrl(null);
    setPendingImage(null, null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = () => {
    if (!text.trim() && !files) return;
    onSubmit({ text: text.trim() || "Make a 3D model from this image.", files });
    setText("");
    clearFile();
    textRef.current?.focus();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="p-3"
    >
      <div className="flex items-end gap-2">
        {previewUrl && (
          <div className="relative mb-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="attachment preview"
              className="h-12 w-12 rounded-lg object-cover"
            />
            <button
              type="button"
              onClick={clearFile}
              className="absolute -right-1 -top-1 rounded-full bg-zinc-900 p-0.5 text-white shadow hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
              aria-label="Remove attachment"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="shrink-0 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            aria-label="Attach image"
            disabled={disabled}
          >
            <ImageIcon className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={disabled}
            rows={1}
            placeholder={files ? "Describe what to do…" : "a tee shirt"}
            className="block max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-zinc-400 disabled:opacity-60"
          />
          {isBusy ? (
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || (!text.trim() && !files)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition",
                "bg-zinc-900 text-white hover:bg-zinc-700 disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:disabled:bg-zinc-700",
              )}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
