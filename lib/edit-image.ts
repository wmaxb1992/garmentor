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
  const endpoint = process.env.MODAL_EDIT_URL;
  if (!endpoint) {
    throw new Error(
      "MODAL_EDIT_URL is not set. Deploy modal/edit.py with `modal deploy modal/edit.py` and set MODAL_EDIT_URL in .env.local.",
    );
  }

  const form = new FormData();
  form.append(
    "image",
    new Blob([imageBytes as unknown as ArrayBuffer], { type: mediaType }),
    "input.png",
  );
  form.append("instruction", instruction);
  if (process.env.E2E_FAST === "1") {
    form.append("steps", "10");
  }

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
      `Modal edit endpoint returned ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  const outBytes = new Uint8Array(await res.arrayBuffer());
  const outMediaType = res.headers.get("content-type") ?? "image/png";

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
