import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

type Env = Record<string, string>;

async function loadDotEnv(path: string): Promise<Env> {
  try {
    const raw = await readFile(path, "utf8");
    const out: Env = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
      if (!m) continue;
      const [, key, val] = m;
      const unquoted = val.replace(/^['"]|['"]$/g, "");
      out[key] = unquoted;
    }
    return out;
  } catch {
    return {};
  }
}

async function warmRunPod(
  url: string,
  apiKey: string | undefined,
  payload: Record<string, unknown>,
  label: string,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify({ input: payload }),
    headers,
  });
  await res.arrayBuffer().catch(() => undefined);
  console.log(`[warmup] ${label} -> ${res.status} in ${Date.now() - t0}ms`);
}

export default async function globalSetup() {
  if (process.env.E2E_SKIP_WARMUP === "1") {
    console.log("[warmup] skipped (E2E_SKIP_WARMUP=1)");
    return;
  }
  const env = {
    ...(await loadDotEnv(resolve(process.cwd(), ".env.local"))),
    ...process.env,
  };
  const apiKey = env.RUNPOD_API_KEY;
  const tasks: Promise<unknown>[] = [];
  if (env.RUNPOD_EDIT_ENDPOINT_URL) {
    tasks.push(
      warmRunPod(
        env.RUNPOD_EDIT_ENDPOINT_URL,
        apiKey,
        { image: TINY_PNG_B64, instruction: "warmup", steps: 1 },
        "edit",
      ).catch((e) => console.log("[warmup] edit failed:", String(e))),
    );
  }
  if (env.RUNPOD_GENERATE_ENDPOINT_URL) {
    tasks.push(
      warmRunPod(
        env.RUNPOD_GENERATE_ENDPOINT_URL,
        apiKey,
        { image: TINY_PNG_B64 },
        "generate",
      ).catch((e) => console.log("[warmup] generate failed:", String(e))),
    );
  }
  if (env.RUNPOD_PATTERN_ENDPOINT_URL) {
    tasks.push(
      warmRunPod(
        env.RUNPOD_PATTERN_ENDPOINT_URL,
        apiKey,
        { image: TINY_PNG_B64 },
        "pattern",
      ).catch((e) => console.log("[warmup] pattern failed:", String(e))),
    );
  }
  if (tasks.length === 0) {
    console.log("[warmup] no RunPod URLs in env; skipping");
    return;
  }
  console.log("[warmup] pre-warming RunPod endpoints in parallel…");
  await Promise.all(tasks);
}
