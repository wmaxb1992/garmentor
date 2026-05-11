import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoId } from "@/lib/utils";

export type EditImageResult = {
  id: string;
  url: string;
  imagePath: string;
  bytes: number;
  mediaType: string;
};

const PUBLIC_DIR = join(process.cwd(), "public", "generated");

export async function editGarmentImage(
  imageBytes: Uint8Array,
  mediaType: string,
  instruction: string,
): Promise<EditImageResult> {
  const endpoint = process.env.RUNPOD_EDIT_ENDPOINT_URL;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!endpoint) {
    throw new Error(
      "RUNPOD_EDIT_ENDPOINT_URL is not set. Deploy runpod/flux-edit/ and set it in .env.local.",
    );
  }
  if (!apiKey) {
    throw new Error("RUNPOD_API_KEY is not set.");
  }

  const payload = {
    input: {
      image: Buffer.from(imageBytes).toString("base64"),
      media_type: mediaType,
      instruction,
      steps: process.env.E2E_FAST === "1" ? 10 : undefined,
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
      `RunPod edit endpoint returned ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  const result = (await res.json()) as {
    status?: string;
    error?: string;
    output?: { image?: string; media_type?: string; error?: string };
  };
  if (result.status === "FAILED" || result.error) {
    throw new Error(`RunPod edit failed: ${result.error ?? "unknown"}`);
  }
  const output: { image?: string; media_type?: string } =
    result.output ??
    (result as unknown as { image?: string; media_type?: string });
  if (!output?.image) throw new Error("RunPod edit response missing image");

  const outBytes = Buffer.from(output.image, "base64");
  const outMediaType = output.media_type ?? "image/png";

  await mkdir(PUBLIC_DIR, { recursive: true });
  const id = nanoId();
  const ext = outMediaType.includes("jpeg") ? "jpg" : "png";
  const filename = `${id}.${ext}`;
  const imagePath = join(PUBLIC_DIR, filename);
  await writeFile(imagePath, outBytes);

  return {
    id,
    url: `/generated/${filename}`,
    imagePath,
    bytes: outBytes.byteLength,
    mediaType: outMediaType,
  };
}

export async function readPublicGeneratedFile(
  url: string,
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  if (!url.startsWith("/generated/")) return null;
  const { readFile } = await import("node:fs/promises");
  const filename = url.slice("/generated/".length);
  if (filename.includes("/") || filename.includes("..")) return null;
  const path = join(PUBLIC_DIR, filename);
  try {
    const bytes = new Uint8Array(await readFile(path));
    const mediaType = filename.endsWith(".jpg") ? "image/jpeg" : "image/png";
    return { bytes, mediaType };
  } catch {
    return null;
  }
}
