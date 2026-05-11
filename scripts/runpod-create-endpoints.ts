#!/usr/bin/env bun
/**
 * Creates the RunPod Serverless endpoints needed by Garmentor.
 *
 * Two-step flow per RunPod's REST API:
 *   1. POST /v1/templates  → templateId (container image + env + disk)
 *   2. POST /v1/endpoints  → endpointId (gpu, workers, idle timeout, ...)
 *
 * Usage:
 *   export RUNPOD_API_KEY=...
 *   bun scripts/runpod-create-endpoints.ts
 *
 * Idempotent: re-finds existing templates/endpoints by name.
 */

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execP = promisify(exec);

const API = "https://rest.runpod.io/v1";
const API_KEY = process.env.RUNPOD_API_KEY;
const OWNER =
  process.env.GITHUB_OWNER ||
  (await $("gh api user -q .login").catch(() => "")) ||
  "wmaxb1992";

if (!API_KEY) {
  console.error("RUNPOD_API_KEY is required.");
  process.exit(1);
}

type Spec = {
  name: string;
  imageName: string;
  containerDiskInGb: number;
  gpuTypeIds: string[];
  workersMin: number;
  workersMax: number;
  idleTimeout: number;
  flashboot: boolean;
  env?: Record<string, string>;
};

const specs: Spec[] = [
  {
    name: "garmentor-chat-vlm",
    imageName: "runpod/worker-v1-vllm:v2.5.0stable-cuda12.1.0",
    containerDiskInGb: 60,
    gpuTypeIds: ["NVIDIA L40S", "NVIDIA A100 80GB PCIe", "NVIDIA H100 PCIe"],
    workersMin: 0,
    workersMax: 1,
    idleTimeout: 10,
    flashboot: true,
    env: {
      MODEL_NAME: "Qwen/Qwen2.5-VL-7B-Instruct",
      ENABLE_AUTO_TOOL_CHOICE: "true",
      TOOL_CALL_PARSER: "hermes",
      MAX_MODEL_LEN: "16384",
    },
  },
  {
    name: "garmentor-pattern",
    imageName: `ghcr.io/${OWNER}/garmentor-pattern:latest`,
    containerDiskInGb: 80,
    gpuTypeIds: ["NVIDIA GeForce RTX 4090", "NVIDIA L40S", "NVIDIA A100 80GB PCIe"],
    workersMin: 0,
    workersMax: 3,
    idleTimeout: 10,
    flashboot: true,
  },
  {
    name: "garmentor-flux-edit",
    imageName: `ghcr.io/${OWNER}/garmentor-flux-edit:latest`,
    containerDiskInGb: 80,
    gpuTypeIds: ["NVIDIA GeForce RTX 4090", "NVIDIA L40S"],
    workersMin: 0,
    workersMax: 2,
    idleTimeout: 10,
    flashboot: true,
  },
  {
    name: "garmentor-3d",
    imageName: `ghcr.io/${OWNER}/garmentor-3d:latest`,
    containerDiskInGb: 30,
    gpuTypeIds: ["NVIDIA GeForce RTX 4090", "NVIDIA L40S", "NVIDIA RTX A4000"],
    workersMin: 0,
    workersMax: 2,
    idleTimeout: 10,
    flashboot: true,
  },
];

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
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
    throw new Error(`RunPod ${method} ${path} -> ${res.status}: ${text.slice(0, 600)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function $(cmd: string): Promise<string> {
  const { stdout } = await execP(cmd);
  return stdout.trim();
}

type RP = { id: string; name: string };

async function findTemplate(name: string): Promise<RP | null> {
  const list = await api<RP[]>("GET", "/templates");
  return Array.isArray(list) ? list.find((t) => t.name === name) ?? null : null;
}

async function findEndpoint(name: string): Promise<RP | null> {
  const list = await api<RP[]>("GET", "/endpoints");
  return Array.isArray(list) ? list.find((e) => e.name === name) ?? null : null;
}

async function createTemplate(spec: Spec): Promise<string> {
  const existing = await findTemplate(spec.name);
  if (existing) {
    console.log(`  ↪ template ${spec.name} exists (${existing.id})`);
    return existing.id;
  }
  const body = {
    name: spec.name,
    imageName: spec.imageName,
    containerDiskInGb: spec.containerDiskInGb,
    env: spec.env ?? {},
    isServerless: true,
    readme: `Auto-created by scripts/runpod-create-endpoints.ts`,
  };
  const out = await api<RP>("POST", "/templates", body);
  console.log(`  ✓ created template ${spec.name} (${out.id})`);
  return out.id;
}

async function createEndpoint(spec: Spec, templateId: string): Promise<string> {
  const existing = await findEndpoint(spec.name);
  if (existing) {
    console.log(`  ↪ endpoint ${spec.name} exists (${existing.id})`);
    return existing.id;
  }
  const body = {
    name: spec.name,
    templateId,
    gpuTypeIds: spec.gpuTypeIds,
    workersMin: spec.workersMin,
    workersMax: spec.workersMax,
    idleTimeout: spec.idleTimeout,
    flashboot: spec.flashboot,
    executionTimeoutMs: 10 * 60 * 1000,
  };
  const out = await api<RP>("POST", "/endpoints", body);
  console.log(`  ✓ created endpoint ${spec.name} (${out.id})`);
  return out.id;
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
  console.log(`Owner: ${OWNER}`);
  const ids: Record<string, string> = {};
  for (const spec of specs) {
    console.log(`\n[${spec.name}]`);
    const tplId = await createTemplate(spec);
    const epId = await createEndpoint(spec, tplId);
    ids[spec.name] = epId;
  }
  const updates: Record<string, string> = {
    RUNPOD_API_KEY: API_KEY!,
    RUNPOD_CHAT_BASE_URL: `https://api.runpod.ai/v2/${ids["garmentor-chat-vlm"]}/openai/v1`,
    RUNPOD_PATTERN_ENDPOINT_URL: `https://api.runpod.ai/v2/${ids["garmentor-pattern"]}/runsync`,
    RUNPOD_EDIT_ENDPOINT_URL: `https://api.runpod.ai/v2/${ids["garmentor-flux-edit"]}/runsync`,
    RUNPOD_GENERATE_ENDPOINT_URL: `https://api.runpod.ai/v2/${ids["garmentor-3d"]}/runsync`,
  };
  await upsertEnvLocal(updates);
  console.log("\n.env.local updated:");
  for (const [k, v] of Object.entries(updates)) {
    console.log(`  ${k}=${k === "RUNPOD_API_KEY" ? "<set>" : v}`);
  }
  console.log("\nStill todo:");
  console.log(" - RUNPOD_CHAT_BASE_URL  (chat-vlm Quick Deploy — set already if you did step 3)");
  console.log(" - RUNPOD_GENERATE_ENDPOINT_URL  (3D mesh per runpod/RUNPOD_SETUP.md)");
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
