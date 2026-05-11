import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoId } from "@/lib/utils";
import type { GcdPattern } from "@/lib/garment-gpt";
import { buildClothInput } from "@/lib/stitch-graph";
import { callRunPodAsync } from "@/lib/runpod-call";

const PUBLIC_DIR = join(process.cwd(), "public", "generated");

export type DrapeMetrics = {
  maxStretch: number;
  maxCompression: number;
  meanStretch: number;
};

export type DrapeResult = {
  id: string;
  drapedGlbUrl: string;
  bytes: number;
  metrics: DrapeMetrics;
};

export async function drapeWithWarp(
  pattern: GcdPattern,
  options?: {
    avatarGlbBase64?: string;
    fabric?: string;
    substeps?: number;
  },
): Promise<DrapeResult> {
  const endpoint = process.env.RUNPOD_CLOTH_SIM_ENDPOINT_URL;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!endpoint) {
    throw new Error(
      "RUNPOD_CLOTH_SIM_ENDPOINT_URL is not set. Deploy runpod/cloth-sim/ first.",
    );
  }
  if (!apiKey) throw new Error("RUNPOD_API_KEY is not set.");

  const clothInput = buildClothInput(pattern);
  const output = await callRunPodAsync<
    {
      cloth_input: ReturnType<typeof buildClothInput>;
      avatar_glb?: string;
      fabric: string;
      substeps: number;
    },
    { draped_glb?: string; metrics?: DrapeMetrics }
  >(endpoint, apiKey, {
    cloth_input: clothInput,
    avatar_glb: options?.avatarGlbBase64,
    fabric: options?.fabric ?? "cotton",
    substeps: options?.substeps ?? 80,
  }, { label: "cloth-sim", timeoutMs: 20 * 60 * 1000 });
  if (!output.draped_glb) throw new Error("RunPod cloth-sim: response missing draped_glb");

  const bytes = Buffer.from(output.draped_glb, "base64");
  await mkdir(PUBLIC_DIR, { recursive: true });
  const id = nanoId();
  const filename = `${id}.draped.glb`;
  await writeFile(join(PUBLIC_DIR, filename), bytes);

  return {
    id,
    drapedGlbUrl: `/generated/${filename}`,
    bytes: bytes.byteLength,
    metrics: output.metrics ?? {
      maxStretch: 1,
      maxCompression: 1,
      meanStretch: 1,
    },
  };
}
