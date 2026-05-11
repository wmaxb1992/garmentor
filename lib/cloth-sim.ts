import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoId } from "@/lib/utils";
import type { GcdPattern } from "@/lib/garment-gpt";
import { buildClothInput } from "@/lib/stitch-graph";

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

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: {
        cloth_input: clothInput,
        avatar_glb: options?.avatarGlbBase64,
        fabric: options?.fabric ?? "cotton",
        substeps: options?.substeps ?? 80,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `RunPod cloth-sim returned ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  const result = (await res.json()) as {
    status?: string;
    error?: string;
    output?: { draped_glb?: string; metrics?: DrapeMetrics; error?: string };
  };
  if (result.status === "FAILED" || result.error) {
    throw new Error(`cloth-sim failed: ${result.error ?? "unknown"}`);
  }
  const output: { draped_glb?: string; metrics?: DrapeMetrics; error?: string } =
    result.output ??
    (result as unknown as { draped_glb?: string; metrics?: DrapeMetrics });
  if (output.error) throw new Error(`cloth-sim error: ${output.error}`);
  if (!output.draped_glb) throw new Error("cloth-sim response missing draped_glb");

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
