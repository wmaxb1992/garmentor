"use client";

import { useCallback, useRef, useState } from "react";
import { ImageIcon, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-store";

export type ChatInputProps = {
  disabled?: boolean;
  onSubmit: (args: { text: string; files?: FileList }) => void;
  onStop?: () => void;
  status: "submitted" | "streaming" | "ready" | "error";
};

const MAX_FILES = 3;

export function ChatInput({ disabled, onSubmit, onStop, status }: ChatInputProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileList | undefined>(undefined);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const { setPendingImage } = useWorkspace();

  const isBusy = status === "submitted" || status === "streaming";

  const revokePreviews = useCallback((urls: string[]) => {
    urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const onFiles = async (next: FileList | null) => {
    if (!next || next.length === 0) {
      revokePreviews(previews);
      setFiles(undefined);
      setPreviews([]);
      setPendingImage(null, null);
      return;
    }
    // Cap at MAX_FILES.
    const arr = Array.from(next).slice(0, MAX_FILES).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) {
      revokePreviews(previews);
      setFiles(undefined);
      setPreviews([]);
      return;
    }
    const dt = new DataTransfer();
    arr.forEach((f) => dt.items.add(f));
    setFiles(dt.files);
    revokePreviews(previews);
    const newPreviews = arr.map((f) => URL.createObjectURL(f));
    setPreviews(newPreviews);
    // setPendingImage tracks the first file for the mockup panel.
    // Reuse the already-created preview URL instead of creating a second one.
    const first = arr[0];
    try {
      const ab = await first.arrayBuffer();
      setPendingImage(newPreviews[0], {
        bytes: new Uint8Array(ab),
        mediaType: first.type,
      });
    } catch {
      // arrayBuffer() can reject if the File has been GC'd (rare edge case).
    }
  };

  const clearFile = () => {
    revokePreviews(previews);
    setFiles(undefined);
    setPreviews([]);
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
        {previews.length > 0 && (
          <div className="mb-1 flex items-center gap-1.5">
            {previews.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt={`attachment ${i + 1}`}
                className="h-12 w-12 rounded-lg object-cover"
              />
            ))}
            <button
              type="button"
              onClick={clearFile}
              className="rounded-full bg-zinc-900 p-0.5 text-white shadow hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
              aria-label="Remove attachments"
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
            multiple
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
