#!/usr/bin/env bun
/**
 * Creates the three RunPod Serverless endpoints needed by Garmentor:
 *   - garmentor-pattern  (GarmentGPT)
 *   - garmentor-flux-edit (FLUX.1-schnell)
 *   - garmentor-generate-3d (TripoSR)  — only if --include-3d is passed
 *
 * The chat VLM endpoint is created via RunPod's UI Quick Deploy
 * (see runpod/chat-vlm/README.md) so we don't touch it here.
 *
 * Usage:
 *   export RUNPOD_API_KEY=...                  # required
 *   export GITHUB_OWNER=wmaxb1992               # default: parsed from `gh`
 *   bun scripts/runpod-create-endpoints.ts      # creates pattern + flux-edit
 *
 * Idempotent: re-running re-finds existing endpoints by name and prints their
 * URLs instead of duplicating.
 */

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const API = "https://rest.runpod.io/v1";
const API_KEY = process.env.RUNPOD_API_KEY;
const OWNER =
  process.env.GITHUB_OWNER ||
  (await $("gh api user -q .login").catch(() => "")) ||
  "wmaxb1992";

if (!API_KEY) {
  console.error("RUNPOD_API_KEY is required. Get one at https://www.runpod.io/console/user/settings");
  process.exit(1);
}

type Endpoint = {
  name: string;
  imageName: string; // GHCR ref
  gpuTypeIds: string[];
  containerDiskInGb: number;
  workersMin: number;
  workersMax: number;
  idleTimeout: number;
  flashboot: boolean;
  env?: Record<string, string>;
};

const endpoints: Endpoint[] = [
  {
    name: "garmentor-pattern",
    imageName: `ghcr.io/${OWNER}/garmentor-pattern:latest`,
    // RTX 4090 (24GB) — Garment-GPT VLM + VQVAE fits comfortably
    gpuTypeIds: ["NVIDIA GeForce RTX 4090", "NVIDIA L40S", "NVIDIA A100 80GB PCIe"],
    containerDiskInGb: 50,
    workersMin: 0,
    workersMax: 3,
    idleTimeout: 10,
    flashboot: true,
  },
  {
    name: "garmentor-flux-edit",
    imageName: `ghcr.io/${OWNER}/garmentor-flux-edit:latest`,
    gpuTypeIds: ["NVIDIA GeForce RTX 4090", "NVIDIA L40S"],
    containerDiskInGb: 50,
    workersMin: 0,
    workersMax: 3,
    idleTimeout: 10,
    flashboot: true,
  },
];

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RunPod ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

async function $(cmd: string): Promise<string> {
  const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

type RunPodEndpoint = {
  id: string;
  name: string;
  imageName?: string;
};

async function listEndpoints(): Promise<RunPodEndpoint[]> {
  const out = await api<RunPodEndpoint[]>("GET", "/endpoints");
  return Array.isArray(out) ? out : [];
}

async function createEndpoint(ep: Endpoint): Promise<RunPodEndpoint> {
  const payload = {
    name: ep.name,
    imageName: ep.imageName,
    gpuTypeIds: ep.gpuTypeIds,
    containerDiskInGb: ep.containerDiskInGb,
    workersMin: ep.workersMin,
    workersMax: ep.workersMax,
    idleTimeout: ep.idleTimeout,
    flashboot: ep.flashboot,
    env: ep.env ?? {},
    executionTimeoutMs: 10 * 60 * 1000,
  };
  return await api<RunPodEndpoint>("POST", "/endpoints", payload);
}

async function ensureEndpoint(ep: Endpoint): Promise<string> {
  const existing = (await listEndpoints()).find((e) => e.name === ep.name);
  if (existing) {
    console.log(`✓ ${ep.name} already exists (id=${existing.id})`);
    return existing.id;
  }
  console.log(`+ creating ${ep.name} from ${ep.imageName}`);
  const created = await createEndpoint(ep);
  console.log(`✓ created ${ep.name} (id=${created.id})`);
  return created.id;
}

async function upsertEnvLocal(updates: Record<string, string>): Promise<void> {
  const path = ".env.local";
  let existing = "";
  if (existsSync(path)) existing = await readFile(path, "utf8");
  const lines = existing.split(/\r?\n/);
  const setKeys = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    if (m && updates[m[1]] !== undefined) {
      out.push(`${m[1]}=${updates[m[1]]}`);
      setKeys.add(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of Object.entries(updates)) {
    if (!setKeys.has(k)) out.push(`${k}=${v}`);
  }
  await writeFile(path, out.join("\n"));
}

async function main(): Promise<void> {
  console.log(`RunPod owner: ${OWNER}`);

  const ids: Record<string, string> = {};
  for (const ep of endpoints) {
    ids[ep.name] = await ensureEndpoint(ep);
  }

  const updates: Record<string, string> = {
    RUNPOD_API_KEY: API_KEY!,
    RUNPOD_PATTERN_ENDPOINT_URL: `https://api.runpod.ai/v2/${ids["garmentor-pattern"]}/runsync`,
    RUNPOD_EDIT_ENDPOINT_URL: `https://api.runpod.ai/v2/${ids["garmentor-flux-edit"]}/runsync`,
  };
  await upsertEnvLocal(updates);

  console.log("\n.env.local updated with:");
  for (const [k, v] of Object.entries(updates)) {
    console.log(`  ${k}=${k === "RUNPOD_API_KEY" ? "<set>" : v}`);
  }

  console.log("\nNext steps:");
  console.log(" 1. Deploy chat-vlm in the RunPod UI (Serverless vLLM Quick Deploy)");
  console.log("    Model: Qwen/Qwen2.5-VL-7B-Instruct");
  console.log("    Copy the OpenAI URL → set RUNPOD_CHAT_BASE_URL in .env.local");
  console.log(" 2. Deploy 3D (TripoSR/TRELLIS) per runpod/RUNPOD_SETUP.md");
  console.log("    Set RUNPOD_GENERATE_ENDPOINT_URL in .env.local");
  console.log(" 3. bun run dev");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
