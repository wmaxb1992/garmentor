import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Tiny 1x1 PNG (89 bytes). Enough to wake the Modal containers — quality
// of the response is irrelevant; we just need weights loaded into VRAM.
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

async function warmEdit(url: string, token: string | undefined): Promise<void> {
  const png = Buffer.from(TINY_PNG_B64, "base64");
  const form = new FormData();
  form.append("image", new Blob([png], { type: "image/png" }), "warm.png");
  form.append("instruction", "warmup");
  form.append("steps", "10");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = Date.now();
  const res = await fetch(url, { method: "POST", body: form, headers });
  await res.arrayBuffer().catch(() => undefined);
  const ms = Date.now() - t0;
  console.log(`[warmup] edit endpoint -> ${res.status} in ${ms}ms`);
}

async function warmMesh(url: string, token: string | undefined): Promise<void> {
  const png = Buffer.from(TINY_PNG_B64, "base64");
  const form = new FormData();
  form.append("image", new Blob([png], { type: "image/png" }), "warm.png");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = Date.now();
  const res = await fetch(url, { method: "POST", body: form, headers });
  await res.arrayBuffer().catch(() => undefined);
  const ms = Date.now() - t0;
  console.log(`[warmup] mesh endpoint -> ${res.status} in ${ms}ms`);
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
  const editUrl = env.MODAL_EDIT_URL;
  const meshUrl = env.MODAL_GENERATE_URL;
  const token = env.MODAL_AUTH_TOKEN;
  if (!editUrl && !meshUrl) {
    console.log("[warmup] no Modal URLs in env; skipping");
    return;
  }
  const tasks: Promise<unknown>[] = [];
  if (editUrl) {
    tasks.push(
      warmEdit(editUrl, token).catch((e) =>
        console.log("[warmup] edit failed (non-fatal):", String(e)),
      ),
    );
  }
  if (meshUrl) {
    tasks.push(
      warmMesh(meshUrl, token).catch((e) =>
        console.log("[warmup] mesh failed (non-fatal):", String(e)),
      ),
    );
  }
  console.log("[warmup] pre-warming Modal containers in parallel…");
  await Promise.all(tasks);
}
