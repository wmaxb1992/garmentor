/**
 * Critic agent: given a generated pattern + drape metrics + the user's
 * reference measurement, decides if the pattern should be modified and
 * what grade deltas to apply. JSON-only LLM call via @ai-sdk/openai-compatible.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { z } from "zod";
import type { GcdPattern, ReferenceMeasurement } from "@/lib/garment-gpt";
import type { DrapeMetrics } from "@/lib/cloth-sim";
import { panelToPolyline } from "@/lib/gcd-to-dxf";

const CRITIC_PROMPT = `You are a senior pattern-maker reviewing an AI-generated garment pattern.
Given the panel dimensions, drape simulation metrics, and the user's reference measurement,
decide if the pattern needs adjustment.

Rules:
- Max stretch ratio > 1.15 = the garment is pulling on the body → enlarge the implicated panel.
- Max compression < 0.85 = the garment has excess fabric → reduce the implicated panel.
- If the user provided a reference (e.g. back_length 72 cm) and the predicted dimension is off
  by more than 3%, propose a delta to align them.
- Don't propose changes smaller than 0.5 cm. Don't propose changes that would push a panel
  out of a plausible garment range (e.g. negative dimensions, sleeve > 100 cm).
- If everything is within tolerance, return should_modify: false with reason "fit converged".`;

const DeltaSchema = z.object({
  panel: z.string().optional().describe("Panel name to grade (omit for global)"),
  chest_cm: z.number().optional(),
  length_cm: z.number().optional(),
  sleeve_cm: z.number().optional(),
  width_cm: z.number().optional(),
});

const CriticOutput = z.object({
  should_modify: z.boolean(),
  reason: z.string(),
  deltas: z.array(DeltaSchema),
});

export type CriticOutput = z.infer<typeof CriticOutput>;

function summarizePattern(pattern: GcdPattern): string {
  const order = pattern.pattern.panel_order?.length
    ? pattern.pattern.panel_order
    : Object.keys(pattern.pattern.panels);
  const rows: string[] = [];
  for (const name of order) {
    const p = pattern.pattern.panels[name];
    if (!p) continue;
    const poly = panelToPolyline(p);
    if (poly.length === 0) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    rows.push(`${name}: ${(maxX - minX).toFixed(1)} cm × ${(maxY - minY).toFixed(1)} cm`);
  }
  return rows.join("\n");
}

export async function critique(input: {
  pattern: GcdPattern;
  drapeMetrics?: DrapeMetrics;
  referenceMeasurement?: ReferenceMeasurement;
}): Promise<CriticOutput> {
  const baseURL = process.env.RUNPOD_CHAT_BASE_URL;
  const apiKey = process.env.RUNPOD_API_KEY;
  const modelId = process.env.CHAT_MODEL ?? "qwen/qwen2.5-vl-7b-instruct";
  if (!baseURL) throw new Error("RUNPOD_CHAT_BASE_URL is not set");

  const provider = createOpenAICompatible({
    name: "runpod",
    baseURL,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });

  const userPrompt =
    `Panel dimensions (cm):\n${summarizePattern(input.pattern)}\n\n` +
    (input.drapeMetrics
      ? `Drape metrics: maxStretch=${input.drapeMetrics.maxStretch.toFixed(2)}, ` +
        `maxCompression=${input.drapeMetrics.maxCompression.toFixed(2)}, ` +
        `meanStretch=${input.drapeMetrics.meanStretch.toFixed(2)}\n\n`
      : "No drape metrics yet.\n\n") +
    (input.referenceMeasurement
      ? `User reference: ${input.referenceMeasurement.kind} = ${input.referenceMeasurement.valueCm} cm\n\n`
      : "No reference measurement provided.\n\n") +
    `Decide if the pattern should be modified. Return JSON with should_modify, reason, deltas.`;

  const result = await generateObject({
    model: provider.chatModel(modelId),
    schema: CriticOutput,
    system: CRITIC_PROMPT,
    prompt: userPrompt,
  });
  return result.object;
}
