"use client";

import { useWorkspace } from "@/lib/workspace-store";
import { useEffect, useState } from "react";

export function MockupPanel() {
  const { state, approvePendingImage, addModel, setPendingImage, setGenerating } = useWorkspace();
  const [progress, setProgress] = useState(0);
  const [isLocalGenerating, setIsLocalGenerating] = useState(false);

  const isProcessing = state.isGenerating || state.isEditing;
  const pendingImageUrl = state.pendingImageUrl;

  useEffect(() => {
    if (isProcessing) {
      setIsLocalGenerating(true);
      setProgress(0);
      
      // Simulate progress for visual feedback
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 95) return prev;
          return prev + Math.random() * 5;
        });
      }, 500);

      return () => clearInterval(interval);
    } else if (isLocalGenerating) {
      // Complete the progress
      setProgress(100);
      setTimeout(() => {
        setIsLocalGenerating(false);
        setProgress(0);
      }, 500);
    }
  }, [isProcessing, isLocalGenerating]);

  const handleApprove = async () => {
    if (!state.pendingImageData) return;
    
    try {
      await approvePendingImage();
      
      // Call API to generate 3D model
      const formData = new FormData();
      // Convert Uint8Array to ArrayBuffer for Blob
      const arrayBuffer = state.pendingImageData.bytes.buffer.slice(
        state.pendingImageData.bytes.byteOffset,
        state.pendingImageData.bytes.byteOffset + state.pendingImageData.bytes.byteLength
      ) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: state.pendingImageData.mediaType });
      formData.append('image', blob, 'image.png');
      
      const response = await fetch('/api/generate-3d', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate 3D model');
      }
      
      const result = await response.json();
      
      addModel({
        id: result.id,
        glbUrl: result.url,
        bytes: result.bytes,
        description: "Generated model",
        sourceImageUrl: result.sourceImageUrl,
      });
      
      // Clear pending image
      setPendingImage(null, null);
      setGenerating(false);
    } catch (error) {
      console.error("Failed to generate 3D model:", error);
      setGenerating(false);
    }
  };

  if (!pendingImageUrl && !isProcessing) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700">
        <div className="text-center">
          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Mockup Image
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Upload an image to get started
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col gap-3">
      {/* Image display */}
      <div className="flex flex-1 items-center justify-center rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {pendingImageUrl ? (
          <div className="relative h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pendingImageUrl}
              alt="Mockup"
              className="h-full w-full object-contain"
              style={{
                opacity: isLocalGenerating ? 0.5 : 1,
                transition: "opacity 0.3s ease",
              }}
            />
            {isLocalGenerating && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-zinc-950/80">
                <div className="text-center">
                  <div className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Generating 3D Model...
                  </div>
                  <div className="h-2 w-48 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full bg-zinc-900 transition-all duration-300 dark:bg-zinc-100"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {Math.round(progress)}% • This may take 30-60s
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div className="text-center">
              <div className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Processing image...
              </div>
              <div className="h-2 w-48 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full bg-zinc-900 transition-all duration-300 dark:bg-zinc-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {Math.round(progress)}%
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Approve button */}
      {pendingImageUrl && !isLocalGenerating && (
        <button
          onClick={handleApprove}
          className="w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Approve & Generate 3D Model
        </button>
      )}
    </div>
  );
}
