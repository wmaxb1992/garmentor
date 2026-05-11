import { generate3dFromBytes } from "@/lib/generate3d";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { error: "Expected multipart/form-data with an `image` field" },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "Missing `image` file field" },
      { status: 400 },
    );
  }

  const mediaType = file.type || "image/png";
  if (!mediaType.startsWith("image/")) {
    return Response.json(
      { error: `Unsupported media type: ${mediaType}` },
      { status: 415 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const out = await generate3dFromBytes(bytes, mediaType);
    return Response.json({
      id: out.id,
      url: out.url,
      bytes: out.bytes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
