import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoId } from "@/lib/utils";

export type RunPodGenerateResult = {
  id: string;
  url: string;
  glbPath: string;
  bytes: number;
  sourceImageUrl: string;
  model: string;
};

const PUBLIC_DIR = join(process.cwd(), "public", "generated");

/**
 * Generate 3D mesh from image using RunPod serverless endpoint.
 * Supports both TripoSR (fast) and TRELLIS 2 (high quality).
 */
export async function generateWithRunPod(
  imageBytes: Uint8Array,
  mediaType: string,
  options?: {
    mcResolution?: number; // TripoSR: 128-512
    numInferenceSteps?: number; // TRELLIS 2: 20-100
    guidanceScale?: number; // TRELLIS 2: 5.0-15.0
    textureResolution?: number; // TRELLIS 2: 1024/2048/4096
  }
): Promise<RunPodGenerateResult> {
  const endpoint = process.env.RUNPOD_ENDPOINT_URL;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpoint) {
    throw new Error(
      "RUNPOD_ENDPOINT_URL is not set. See runpod/RUNPOD_SETUP.md for deployment instructions."
    );
  }

  if (!apiKey) {
    throw new Error(
      "RUNPOD_API_KEY is not set. Get your API key from https://www.runpod.io/console/user/settings"
    );
  }

  // Convert image to base64
  const imageB64 = Buffer.from(imageBytes).toString("base64");

  // Prepare request payload
  const payload = {
    input: {
      image: imageB64,
      remove_background: true,
      ...(options?.mcResolution && { mc_resolution: options.mcResolution }),
      ...(options?.numInferenceSteps && {
        num_inference_steps: options.numInferenceSteps,
      }),
      ...(options?.guidanceScale && { guidance_scale: options.guidanceScale }),
      ...(options?.textureResolution && {
        texture_resolution: options.textureResolution,
      }),
    },
  };

  // Call RunPod endpoint
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `RunPod endpoint returned ${response.status}: ${text.slice(0, 500)}`
    );
  }

  const result = await response.json();

  // Handle RunPod response format
  if (result.status === "FAILED") {
    throw new Error(`RunPod generation failed: ${result.error || "Unknown error"}`);
  }

  const output = result.output || result;

  if (output.error) {
    throw new Error(`RunPod generation error: ${output.error}`);
  }

  if (!output.glb) {
    throw new Error("RunPod response missing GLB data");
  }

  // Decode GLB from base64
  const glbBytes = Buffer.from(output.glb, "base64");

  // Save GLB file
  await mkdir(PUBLIC_DIR, { recursive: true });
  const id = nanoId();
  const glbFilename = `${id}.glb`;
  const glbPath = join(PUBLIC_DIR, glbFilename);
  await writeFile(glbPath, glbBytes);

  // Save source image
  const ext = mediaType.includes("jpeg") || mediaType.includes("jpg")
    ? "jpg"
    : mediaType.includes("webp")
    ? "webp"
    : "png";
  const srcFilename = `${id}.src.${ext}`;
  await writeFile(join(PUBLIC_DIR, srcFilename), imageBytes);

  return {
    id,
    url: `/generated/${glbFilename}`,
    glbPath,
    bytes: glbBytes.byteLength,
    sourceImageUrl: `/generated/${srcFilename}`,
    model: output.model || "RunPod",
  };
}

/**
 * Generate 3D mesh with automatic fallback from RunPod to Modal.
 * Tries RunPod first (faster), falls back to Modal if RunPod fails.
 */
export async function generate3dWithFallback(
  imageBytes: Uint8Array,
  mediaType: string
): Promise<RunPodGenerateResult> {
  const hasRunPod = process.env.RUNPOD_ENDPOINT_URL && process.env.RUNPOD_API_KEY;
  const hasModal = process.env.MODAL_GENERATE_URL;

  if (!hasRunPod && !hasModal) {
    throw new Error(
      "No 3D generation service configured. Set up either RunPod or Modal."
    );
  }

  // Try RunPod first if available
  if (hasRunPod) {
    try {
      console.log("[3D] Attempting generation with RunPod...");
      const result = await generateWithRunPod(imageBytes, mediaType);
      console.log(`[3D] RunPod success: ${result.model}, ${result.bytes} bytes`);
      return result;
    } catch (error) {
      console.warn("[3D] RunPod failed, trying fallback:", error);
      
      // If Modal is not available, rethrow the error
      if (!hasModal) {
        throw error;
      }
    }
  }

  // Fallback to Modal
  if (hasModal) {
    console.log("[3D] Using Modal as fallback...");
    const { generate3dFromBytes } = await import("@/lib/generate3d");
    const result = await generate3dFromBytes(imageBytes, mediaType);
    console.log(`[3D] Modal success: ${result.bytes} bytes`);
    return result as RunPodGenerateResult;
  }

  throw new Error("All 3D generation services failed");
}
