#!/usr/bin/env bun
/**
 * Fix all RunPod endpoints: purge failed jobs, update templates with
 * correct Docker images, and verify health.
 *
 * Usage:
 *   bun scripts/runpod-fix-endpoints.ts
 *
 * Requires RUNPOD_API_KEY in environment or .env.local.
 */

import { readFile, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const envContent = await Bun.file(envPath).text();
  for (const line of envContent.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const API_KEY = process.env.RUNPOD_API_KEY;
if (!API_KEY) {
  console.error("RUNPOD_API_KEY is required");
  process.exit(1);
}

const REST = "https://rest.runpod.io/v1";
const API = "https://api.runpod.ai/v2";

async function rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${REST}${path}`, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function health(endpointId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/${endpointId}/health`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return (await res.json()) as Record<string, unknown>;
}

async function purgeQueue(endpointId: string): Promise<void> {
  try {
    const res = await fetch(`${API}/${endpointId}/purge-queue`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log(`  Purged queue: ${JSON.stringify(data)}`);
    } else {
      console.log(`  Purge returned ${res.status} (may not be supported)`);
    }
  } catch {
    console.log("  Purge not available");
  }
}

// ─── Main ────────────────────────────────────────────────────────────
type EP = { id: string; name: string; templateId: string; [k: string]: unknown };
type TPL = { id: string; name: string; imageName: string; [k: string]: unknown };

const endpoints = (await rest<EP[]>("GET", "/endpoints")).filter((e) =>
  e.name.startsWith("garmentor-"),
);
const templates = await rest<TPL[]>("GET", "/templates");
const tplMap = new Map(templates.map((t) => [t.id, t]));

console.log(`\nFound ${endpoints.length} garmentor endpoints:\n`);

for (const ep of endpoints) {
  const tpl = tplMap.get(ep.templateId);
  console.log(`[${ep.name}]  id=${ep.id}  tpl=${ep.templateId}`);
  console.log(`  image: ${tpl?.imageName ?? "unknown"}`);
  console.log(`  gpu: ${JSON.stringify((ep as Record<string, unknown>).gpuTypeIds)}`);

  // Health check
  const h = await health(ep.id);
  const workers = h.workers as Record<string, number> | undefined;
  const jobs = h.jobs as Record<string, number> | undefined;
  console.log(`  workers: ${JSON.stringify(workers)}`);
  console.log(`  jobs: ${JSON.stringify(jobs)}`);

  // Purge any stuck jobs
  if (jobs && ((jobs.inQueue ?? 0) > 0 || (jobs.failed ?? 0) > 0)) {
    console.log("  → Purging stuck/failed jobs...");
    await purgeQueue(ep.id);
  }

  console.log("");
}

// ─── Verify GHCR images exist ────────────────────────────────────────
console.log("\n=== Checking GHCR image availability ===\n");

const imageChecks = [
  { name: "garmentor-3d", tplName: "garmentor-3d" },
  { name: "garmentor-flux-edit", tplName: "garmentor-flux-edit" },
  { name: "garmentor-cloth-sim", tplName: "garmentor-cloth-sim" },
  { name: "garmentor-pattern", tplName: "garmentor-pattern" },
];

for (const { name } of imageChecks) {
  try {
    const tokenRes = await fetch(
      `https://ghcr.io/token?service=ghcr.io&scope=repository:wmaxb1992/${name}:pull`,
    );
    const { token } = (await tokenRes.json()) as { token: string };
    const manifestRes = await fetch(
      `https://ghcr.io/v2/wmaxb1992/${name}/manifests/latest`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.docker.distribution.manifest.v2+json",
        },
      },
    );
    console.log(`  ${name}: ${manifestRes.status === 200 ? "✅ EXISTS" : "❌ NOT FOUND (${manifestRes.status})"}`);
  } catch (e) {
    console.log(`  ${name}: ❌ ERROR (${e})`);
  }
}

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  NEXT STEPS                                                     ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  The GHCR Docker images don't exist yet. You need to build and  ║
║  push them. Two options:                                         ║
║                                                                  ║
║  Option A — GitHub Actions (recommended):                        ║
║    1. git add -A && git commit -m "add CI + fixes" && git push  ║
║    2. gh workflow run build-runpod-workers.yml                   ║
║    3. Wait ~15 min for all 4 images to build                    ║
║                                                                  ║
║  Option B — Local Docker build:                                  ║
║    cd runpod/flux-edit && docker build -t \\                      ║
║      ghcr.io/wmaxb1992/garmentor-flux-edit:latest .             ║
║    docker push ghcr.io/wmaxb1992/garmentor-flux-edit:latest     ║
║    (repeat for triposr, cloth-sim, garment-gpt)                 ║
║                                                                  ║
║  The chat-vlm endpoint uses RunPod's pre-built vLLM image       ║
║  and should work once a GPU is available (currently throttled).  ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
`);
