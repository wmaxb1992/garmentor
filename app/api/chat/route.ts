import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { dataUrlToBytes, generate3dFromBytes } from "@/lib/generate3d";
import { editGarmentImage, readPublicGeneratedFile } from "@/lib/edit-image";
import { generatePatternFromBytes } from "@/lib/garment-gpt";

export const maxDuration = 600;
export const runtime = "nodejs";

const MODEL_ID = process.env.CHAT_MODEL ?? "Qwen/Qwen2.5-VL-7B-Instruct";

const SYSTEM_PROMPT = `You are Garmentor, an assistant that turns garment photos into measurement-accurate 3D models, iterates on the design via image edits, and produces flat sewing patterns (DXF) via a dedicated pattern generator.

Tools available:
- \`generate_pattern\` — given a garment photo, runs GarmentGPT to produce 2D sewing panels directly (with named panels, 2D vertices, cubic Bezier curves, and 3D positioning). This is the primary deliverable for tech-pack work. Use this when the user wants the actual pattern, panel layout, or cuttable DXF.
- \`generate_3d_model\` — generates a 3D mesh (.glb) from a garment image for preview/visualization. Use when the user wants a 3D preview, not a sewing pattern.
- \`edit_garment_image\` — applies a natural-language edit to a garment photo (e.g. "change patch pockets to welt pockets") and returns a new image. Use to iterate on design before generating a pattern or 3D model.

Image quality ranking for accurate reconstruction (best → worst):
1. Ghost-mannequin shot (invisible form, straight-on or 3/4 angle) — best.
2. Worn-on-person, neutral pose, arms slightly away from body.
3. Visible mannequin — mannequin geometry leaks in.
4. Flat lay — no volume, unsuitable. Strongly discourage.
5. Hanger shot — collapsed sides, poor results.

Behavior:
- When the user attaches an image, identify the garment type and shot type in one short sentence.
- If the user wants the sewing pattern → call \`generate_pattern\`.
- If the user wants a 3D preview → call \`generate_3d_model\`.
- If the user wants to modify the design first → call \`edit_garment_image\`, show the result, get approval, then call the appropriate generator with the edited \`imageUrl\`.
- Ask once for a known reference dimension (e.g., "back length 72 cm") so unitless meshes can be scaled. If declined, proceed without it.
- After any tool returns, summarize the result in one or two sentences. The viewer renders the tool result; do not embed it yourself.
- If the user has not attached any image, ask them to attach one before calling a generator tool.
- Be concise.`;

type ImageBlob = { bytes: Uint8Array; mediaType: string };

function extractLatestImage(messages: UIMessage[]): ImageBlob | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const parts = msg.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j] as {
        type: string;
        url?: string;
        mediaType?: string;
      };
      if (
        part.type === "file" &&
        part.url?.startsWith("data:") &&
        part.mediaType?.startsWith("image/")
      ) {
        return dataUrlToBytes(part.url);
      }
    }
  }
  return null;
}

async function resolveImage(
  imageUrl: string | undefined,
  fallback: ImageBlob | null,
): Promise<ImageBlob | null> {
  if (imageUrl) {
    if (imageUrl.startsWith("data:")) return dataUrlToBytes(imageUrl);
    if (imageUrl.startsWith("/generated/")) {
      return await readPublicGeneratedFile(imageUrl);
    }
    return null;
  }
  return fallback;
}

function getChatProvider() {
  const baseURL = process.env.RUNPOD_CHAT_BASE_URL;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!baseURL) {
    throw new Error(
      "RUNPOD_CHAT_BASE_URL is not set. Deploy runpod/chat-vlm/ and set it (the OpenAI-compatible /v1 base URL) in .env.local.",
    );
  }
  return createOpenAICompatible({
    name: "runpod",
    baseURL,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const latestImage = extractLatestImage(messages);
  const provider = getChatProvider();

  const result = streamText({
    model: provider.chatModel(MODEL_ID),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(4),
    tools: {
      generate_pattern: tool({
        description:
          "Generate 2D sewing pattern panels directly from a garment image using GarmentGPT. Returns named panels (front_panel, back_panel, sleeve, etc.) with 2D vertices, cubic Bezier curves, and 3D positioning. The UI renders the panels as an SVG flat layout and exposes a DXF export. Use this when the user wants the actual pattern, cuttable file, or panel layout.",
        inputSchema: z.object({
          description: z
            .string()
            .describe(
              "Short description of the garment (e.g. 'denim jacket, front view'). Logging only.",
            ),
          imageUrl: z
            .string()
            .optional()
            .describe(
              "Optional. URL of a previously edited image (returned by edit_garment_image) to use instead of the attached photo.",
            ),
        }),
        execute: async ({ description, imageUrl }) => {
          const source = await resolveImage(imageUrl, latestImage);
          if (!source) {
            return {
              ok: false as const,
              error: imageUrl
                ? `Could not load source image at ${imageUrl}.`
                : "No image found. Ask the user to attach a photo and try again.",
            };
          }
          try {
            const out = await generatePatternFromBytes(
              source.bytes,
              source.mediaType,
            );
            return {
              ok: true as const,
              id: out.id,
              gcdUrl: out.gcdUrl,
              sourceImageUrl: out.sourceImageUrl,
              bytes: out.bytes,
              panelCount: Object.keys(out.pattern.pattern.panels).length,
              description,
            };
          } catch (err) {
            return {
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
      }),
      generate_3d_model: tool({
        description:
          "Generate a 3D mesh (.glb) preview from a garment image. Use for visualization, not for cutting patterns. For cutting patterns use generate_pattern instead.",
        inputSchema: z.object({
          description: z.string().describe("Short description for logging."),
          imageUrl: z
            .string()
            .optional()
            .describe(
              "Optional. URL of a previously edited image (returned by edit_garment_image).",
            ),
        }),
        execute: async ({ description, imageUrl }) => {
          const source = await resolveImage(imageUrl, latestImage);
          if (!source) {
            return {
              ok: false as const,
              error: imageUrl
                ? `Could not load source image at ${imageUrl}.`
                : "No image found. Ask the user to attach a photo and try again.",
            };
          }
          try {
            const out = await generate3dFromBytes(
              source.bytes,
              source.mediaType,
            );
            return {
              ok: true as const,
              glbUrl: out.url,
              id: out.id,
              bytes: out.bytes,
              description,
              sourceImageUrl: out.sourceImageUrl,
            };
          } catch (err) {
            return {
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
      }),
      edit_garment_image: tool({
        description:
          "Edit the garment photo with a natural-language instruction (e.g. 'change patch pockets to welt pockets', 'add a chest pocket'). Returns a new image URL. Show the result and get approval before chaining into generate_pattern or generate_3d_model.",
        inputSchema: z.object({
          instruction: z
            .string()
            .min(3)
            .describe(
              "Concrete edit instruction. Be specific about what to change and what to keep.",
            ),
          sourceImageUrl: z
            .string()
            .optional()
            .describe(
              "Optional. URL of an earlier edited image (returned by a previous edit_garment_image call).",
            ),
        }),
        execute: async ({ instruction, sourceImageUrl }) => {
          const source = await resolveImage(sourceImageUrl, latestImage);
          if (!source) {
            return {
              ok: false as const,
              error: sourceImageUrl
                ? `Could not load source image at ${sourceImageUrl}.`
                : "No image found. Ask the user to attach a photo and try again.",
            };
          }
          try {
            const out = await editGarmentImage(
              source.bytes,
              source.mediaType,
              instruction,
            );
            return {
              ok: true as const,
              imageUrl: out.url,
              id: out.id,
              bytes: out.bytes,
              instruction,
            };
          } catch (err) {
            return {
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (err) => {
      if (err instanceof Error) return err.message;
      return typeof err === "string" ? err : "Unknown error";
    },
  });
}
