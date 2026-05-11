import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoId } from "@/lib/utils";

export type Generate3dResult = {
  id: string;
  url: string;
  glbPath: string;
  bytes: number;
  sourceImageUrl: string;
};

const PUBLIC_DIR = join(process.cwd(), "public", "generated");

function sourceImageExt(mediaType: string): string {
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  return "png";
}

export async function generate3dFromBytes(
  imageBytes: Uint8Array,
  mediaType: string,
): Promise<Generate3dResult> {
  const endpoint = process.env.RUNPOD_GENERATE_ENDPOINT_URL;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!endpoint) {
    throw new Error(
      "RUNPOD_GENERATE_ENDPOINT_URL is not set. Deploy runpod/ and set it in .env.local.",
    );
  }
  if (!apiKey) {
    throw new Error("RUNPOD_API_KEY is not set.");
  }

  const payload = {
    input: {
      image: Buffer.from(imageBytes).toString("base64"),
      remove_background: true,
    },
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
      `RunPod generate endpoint returned ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  const result = (await res.json()) as {
    status?: string;
    error?: string;
    output?: { glb?: string; error?: string };
  };
  if (result.status === "FAILED" || result.error) {
    throw new Error(`RunPod 3D generation failed: ${result.error ?? "unknown"}`);
  }
  const output = result.output ?? (result as unknown as { glb?: string });
  if (!output?.glb) throw new Error("RunPod 3D response missing glb");

  const glbBuffer = Buffer.from(output.glb, "base64");

  await mkdir(PUBLIC_DIR, { recursive: true });
  const id = nanoId();
  const filename = `${id}.glb`;
  const glbPath = join(PUBLIC_DIR, filename);
  await writeFile(glbPath, glbBuffer);

  const srcExt = sourceImageExt(mediaType);
  const sourceFilename = `${id}.src.${srcExt}`;
  await writeFile(join(PUBLIC_DIR, sourceFilename), imageBytes);

  return {
    id,
    url: `/generated/${filename}`,
    glbPath,
    bytes: glbBuffer.byteLength,
    sourceImageUrl: `/generated/${sourceFilename}`,
  };
}

export function dataUrlToBytes(dataUrl: string): {
  bytes: Uint8Array;
  mediaType: string;
} {
  const match = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Invalid data URL");
  }
  const mediaType = match[1];
  const isBase64 = /;base64/i.test(dataUrl);
  const payload = match[2];
  const bytes = isBase64
    ? Uint8Array.from(Buffer.from(payload, "base64"))
    : new TextEncoder().encode(decodeURIComponent(payload));
  return { bytes, mediaType };
}
