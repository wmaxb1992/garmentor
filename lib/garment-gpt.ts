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
  scaleApplied?: number;
};

export type ReferenceMeasurement = {
  kind: "back_length" | "chest_girth" | "total_width";
  valueCm: number;
};

/**
 * Rescale every panel vertex so the indicated predicted measurement matches
 * the user's real-world cm value. Returns the multiplicative scale factor.
 */
export function rescalePatternByReference(
  pattern: GcdPattern,
  ref: ReferenceMeasurement,
): number {
  const panels = Object.values(pattern.pattern.panels);
  if (panels.length === 0) return 1;
  let predicted = 0;
  if (ref.kind === "back_length") {
    let yMin = Infinity,
      yMax = -Infinity;
    for (const p of panels) {
      for (const [, y] of p.vertices) {
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    predicted = yMax - yMin;
  } else if (ref.kind === "total_width") {
    let xMin = Infinity,
      xMax = -Infinity;
    for (const p of panels) {
      for (const [x] of p.vertices) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }
    }
    predicted = xMax - xMin;
  } else {
    // chest_girth: sum the X-extent of every front-facing panel (z>0 in translation)
    let sum = 0;
    for (const p of panels) {
      if ((p.translation?.[2] ?? 0) < 0) continue;
      let xMin = Infinity,
        xMax = -Infinity;
      for (const [x] of p.vertices) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }
      if (Number.isFinite(xMin)) sum += xMax - xMin;
    }
    predicted = sum * 2; // body wraps around -> double the front sum
  }
  if (!Number.isFinite(predicted) || predicted <= 0) return 1;
  const scale = ref.valueCm / predicted;
  for (const p of panels) {
    p.vertices = p.vertices.map(([x, y]) => [x * scale, y * scale]);
    p.translation = [
      p.translation[0] * scale,
      p.translation[1] * scale,
      p.translation[2] * scale,
    ];
  }
  return scale;
}

function sourceImageExt(mediaType: string): string {
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  return "png";
}

export async function generatePatternFromBytes(
  imageBytes: Uint8Array,
  mediaType: string,
  reference?: ReferenceMeasurement,
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

  let scaleApplied: number | undefined;
  if (reference) {
    scaleApplied = rescalePatternByReference(pattern, reference);
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
    scaleApplied,
  };
}
