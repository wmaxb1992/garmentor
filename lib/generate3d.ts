import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoId } from "@/lib/utils";
import { callRunPodAsync } from "@/lib/runpod-call";

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

  const output = await callRunPodAsync<
    { image: string; remove_background: boolean },
    { glb?: string }
  >(endpoint, apiKey, {
    image: Buffer.from(imageBytes).toString("base64"),
    remove_background: true,
  }, { label: "3d", timeoutMs: 20 * 60 * 1000 });
  if (!output?.glb) throw new Error("RunPod 3D: response missing glb");

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
