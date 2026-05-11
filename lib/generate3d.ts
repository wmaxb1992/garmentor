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
  const endpoint = process.env.MODAL_GENERATE_URL;
  if (!endpoint) {
    throw new Error(
      "MODAL_GENERATE_URL is not set. Deploy modal/app.py with `modal deploy modal/app.py` and set MODAL_GENERATE_URL in .env.local.",
    );
  }

  const form = new FormData();
  form.append(
    "image",
    new Blob([imageBytes as unknown as ArrayBuffer], { type: mediaType }),
    "input.png",
  );

  const headers: Record<string, string> = {};
  if (process.env.MODAL_AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.MODAL_AUTH_TOKEN}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    body: form,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Modal generate endpoint returned ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  const glbBuffer = new Uint8Array(await res.arrayBuffer());

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
