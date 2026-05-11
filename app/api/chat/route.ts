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
import { drapeWithWarp } from "@/lib/cloth-sim";
import { refinePattern } from "@/lib/workflow/refine-pattern";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoId } from "@/lib/utils";

export const maxDuration = 600;
export const runtime = "nodejs";

const MODEL_ID = process.env.CHAT_MODEL ?? "qwen/qwen2.5-vl-7b-instruct";

const SYSTEM_PROMPT = `You are Garmentor, an assistant that turns garment photos into measurement-accurate 3D models, iterates on the design via image edits, and produces flat sewing patterns (DXF) via a dedicated pattern generator.

Tools available:
- \`generate_pattern\` — given a garment photo, runs GarmentGPT to produce 2D sewing panels directly. Primary deliverable for tech-pack / cuttable work.
- \`generate_3d_model\` — generates a 3D mesh (.glb) from a garment image for visualization on the workspace 3D viewer.
- \`edit_garment_image\` — natural-language edit on a photo (e.g. "change patch pockets to welt pockets") returning a new image.
- \`drape_pattern\` — given a previously generated pattern, runs an NVIDIA Warp XPBD cloth simulation to drape the stitched panels on an avatar. Returns a draped GLB + fit metrics (stretch, compression). Call this when the user wants to validate fit, see the garment "on body", or detect pulling/excess fabric. Requires a prior \`generate_pattern\` call; pass the resulting \`patternId\`.
- \`refine_pattern\` — agentic refinement loop: drape → critic → grade-delta → re-drape, up to 3 cycles. Use when the user supplies a reference measurement (e.g. "back length 72 cm") AND wants the system to self-correct until fit converges. Pass the prior \`patternId\` + \`referenceMeasurement\`. Returns the converged pattern + drape + per-cycle history.

Tool-firing policy:
- When the user wants both the pattern and a preview (the typical case after attaching a photo), call \`generate_pattern\` AND \`generate_3d_model\` IN PARALLEL in the same step. They share the source image and both results bind to the same workspace item.
- Calibration: ask the user for ONE reference measurement (e.g. "back length 72 cm" or "chest girth 110 cm"). If they give it, pass \`referenceMeasurement: { kind, valueCm }\` to \`generate_pattern\` so the panels are absolute-scaled. If they decline, proceed without it.

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

  console.log("[chat] model:", MODEL_ID, "baseURL:", process.env.RUNPOD_CHAT_BASE_URL);
  // DEBUG: tools disabled to isolate streaming issue
  if (process.env.CHAT_DEBUG_NO_TOOLS === "1") {
    const r = streamText({
      model: provider.chatModel(MODEL_ID),
      system: "You are a helpful assistant.",
      messages: await convertToModelMessages(messages),
      onFinish: ({ text, finishReason, usage }) => {
        console.log("[chat-debug] onFinish:", { textLen: text?.length, finishReason, usage });
      },
      onError: ({ error }) => {
        console.error("[chat-debug] onError:", error);
      },
    });
    return r.toUIMessageStreamResponse();
  }
  const result = streamText({
    model: provider.chatModel(MODEL_ID),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(4),
    onFinish: ({ text, toolCalls, finishReason, usage }) => {
      console.log("[chat] onFinish:", { textLen: text?.length, toolCallCount: toolCalls?.length, finishReason, usage });
    },
    onError: ({ error }) => {
      console.error("[chat] streamText onError:", error);
    },
    tools: {
      generate_pattern: tool({
        description:
          "Generate 2D sewing pattern panels directly from a garment image using GarmentGPT. Returns named panels with 2D vertices and cubic Bezier curves. UI renders an SVG flat layout + DXF export. Use this when the user wants the actual cuttable pattern. If the user supplies a reference dimension (e.g. 'back length 72 cm') include it as `referenceMeasurement` to calibrate absolute sizing.",
        inputSchema: z.object({
          description: z
            .string()
            .describe("Short description (e.g. 'denim jacket, front view')."),
          imageUrl: z
            .string()
            .optional()
            .describe(
              "Optional. URL of a previously edited image (returned by edit_garment_image).",
            ),
          referenceMeasurement: z
            .object({
              kind: z.enum(["back_length", "chest_girth", "total_width"]),
              valueCm: z.number().positive(),
            })
            .optional()
            .describe(
              "Optional. Real-world measurement to calibrate panel scale. back_length = top-of-collar to hem; chest_girth = full circumference; total_width = widest cross-section.",
            ),
        }),
        execute: async ({ description, imageUrl, referenceMeasurement }) => {
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
              referenceMeasurement,
            );
            return {
              ok: true as const,
              id: out.id,
              gcdUrl: out.gcdUrl,
              sourceImageUrl: out.sourceImageUrl,
              bytes: out.bytes,
              panelCount: Object.keys(out.pattern.pattern.panels).length,
              scaleApplied: out.scaleApplied,
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
      refine_pattern: tool({
        description:
          "Run the critic loop: drape the pattern, look at fit metrics + reference measurement, propose grade deltas, re-drape, up to 3 cycles. Returns the converged pattern + drape and a per-cycle history. Use when the user wants the system to self-correct a pattern instead of accepting the first generation.",
        inputSchema: z.object({
          patternId: z.string().describe("`id` returned by an earlier generate_pattern call."),
          referenceMeasurement: z
            .object({
              kind: z.enum(["back_length", "chest_girth", "total_width"]),
              valueCm: z.number().positive(),
            })
            .optional(),
          fabric: z
            .enum(["cotton", "denim", "silk", "leather", "wool", "linen"])
            .optional(),
          maxCycles: z.number().int().min(1).max(5).optional(),
        }),
        execute: async ({ patternId, referenceMeasurement, fabric, maxCycles }) => {
          try {
            const path = join(process.cwd(), "public", "generated", `${patternId}.gcd.json`);
            const raw = await readFile(path, "utf8");
            const pattern = JSON.parse(raw);
            const result = await refinePattern({
              pattern,
              referenceMeasurement,
              fabric,
              maxCycles,
            });
            // Persist the refined pattern so the UI Pattern tab can pick it up.
            const refinedId = nanoId();
            const refinedFilename = `${refinedId}.gcd.json`;
            await writeFile(
              join(process.cwd(), "public", "generated", refinedFilename),
              JSON.stringify(result.finalPattern),
              "utf8",
            );
            return {
              ok: true as const,
              refinedPatternId: refinedId,
              refinedGcdUrl: `/generated/${refinedFilename}`,
              cycles: result.cycles.map((c) => ({
                cycle: c.cycle,
                maxStretch: c.drape.metrics.maxStretch,
                maxCompression: c.drape.metrics.maxCompression,
                shouldModify: c.critique.should_modify,
                reason: c.critique.reason,
                deltaCount: c.critique.deltas.length,
              })),
              finalMetrics: result.finalDrape.metrics,
              finalDrapedGlbUrl: result.finalDrape.drapedGlbUrl,
              converged: result.converged,
            };
          } catch (err) {
            return {
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
      }),
      drape_pattern: tool({
        description:
          "Run an NVIDIA Warp XPBD cloth simulation that stitches and drapes the GarmentGPT 2D panels into a draped 3D garment. Use after generate_pattern when the user wants fit validation or to see the garment on body. Returns metrics: maxStretch>1.15 means pulling, maxCompression<0.85 means excess fabric.",
        inputSchema: z.object({
          patternId: z
            .string()
            .describe(
              "The `id` returned by an earlier generate_pattern call (we'll load the GCD JSON from public/generated/{id}.gcd.json).",
            ),
          fabric: z
            .enum(["cotton", "denim", "silk", "leather", "wool", "linen"])
            .optional()
            .describe("Fabric preset that sets stretch/bend stiffness."),
          substeps: z
            .number()
            .int()
            .min(20)
            .max(200)
            .optional()
            .describe("XPBD substeps (default 80). More = better convergence, slower."),
        }),
        execute: async ({ patternId, fabric, substeps }) => {
          try {
            const path = join(process.cwd(), "public", "generated", `${patternId}.gcd.json`);
            const raw = await readFile(path, "utf8");
            const pattern = JSON.parse(raw);
            const out = await drapeWithWarp(pattern, { fabric, substeps });
            return {
              ok: true as const,
              id: out.id,
              patternId,
              drapedGlbUrl: out.drapedGlbUrl,
              bytes: out.bytes,
              metrics: out.metrics,
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
      console.error("[chat] stream error:", err);
      if (err instanceof Error) return `${err.name}: ${err.message}`;
      return typeof err === "string" ? err : JSON.stringify(err);
    },
  });
}
