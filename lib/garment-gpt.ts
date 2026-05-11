import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoId } from "@/lib/utils";

const PUBLIC_DIR = join(process.cwd(), "public", "generated");

export type GcdEdge = {
  endpoints: [number, number];
  curvature?:
    | { type: "cubic"; params: [[number, number], [number, number]] }
    | { type: "circle"; params: [number, number, number] };
};

export type GcdPanel = {
  translation: [number, number, number];
  rotation: number[];
  vertices: Array<[number, number]>;
  edges: GcdEdge[];
};

export type GcdStitch = Array<{ panel: string; edge: number }>;

export type GcdPattern = {
  pattern: {
    panels: Record<string, GcdPanel>;
    stitches: GcdStitch[];
    panel_order: string[];
  };
  parameters?: Record<string, unknown>;
  parameter_order?: string[];
  properties: {
    curvature_coords: "relative" | "absolute";
    normalize_panel_translation: boolean;
    normalized_edge_loops: boolean;
    units_in_meter: number;
  };
};

export type GeneratePatternResult = {
  id: string;
  gcdUrl: string;
  sourceImageUrl: string;
  bytes: number;
  pattern: GcdPattern;
};

function sourceImageExt(mediaType: string): string {
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  return "png";
}

export async function generatePatternFromBytes(
  imageBytes: Uint8Array,
  mediaType: string,
): Promise<GeneratePatternResult> {
  const endpoint = process.env.RUNPOD_PATTERN_ENDPOINT_URL;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!endpoint) {
    throw new Error(
      "RUNPOD_PATTERN_ENDPOINT_URL is not set. Deploy runpod/garment-gpt/ and set it in .env.local.",
    );
  }
  if (!apiKey) {
    throw new Error("RUNPOD_API_KEY is not set.");
  }

  const imageB64 = Buffer.from(imageBytes).toString("base64");
  const payload = {
    input: { image: imageB64, media_type: mediaType },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `RunPod pattern endpoint returned ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  const result = (await res.json()) as {
    status?: string;
    error?: string;
    output?: { gcd?: GcdPattern; error?: string };
  };
  if (result.status === "FAILED" || result.error) {
    throw new Error(`RunPod generation failed: ${result.error ?? "unknown"}`);
  }
  const output: { gcd?: GcdPattern; error?: string } =
    result.output ??
    (result as unknown as { gcd?: GcdPattern; error?: string });
  if (output.error) throw new Error(`RunPod generation error: ${output.error}`);
  const pattern = output.gcd;
  if (!pattern?.pattern?.panels) {
    throw new Error("RunPod response missing gcd.pattern.panels");
  }

  await mkdir(PUBLIC_DIR, { recursive: true });
  const id = nanoId();
  const gcdJson = JSON.stringify(pattern);
  const gcdFilename = `${id}.gcd.json`;
  await writeFile(join(PUBLIC_DIR, gcdFilename), gcdJson, "utf8");

  const srcExt = sourceImageExt(mediaType);
  const srcFilename = `${id}.src.${srcExt}`;
  await writeFile(join(PUBLIC_DIR, srcFilename), imageBytes);

  return {
    id,
    gcdUrl: `/generated/${gcdFilename}`,
    sourceImageUrl: `/generated/${srcFilename}`,
    bytes: Buffer.byteLength(gcdJson, "utf8"),
    pattern,
  };
}
