/**
 * Shared RunPod invocation with FlashBoot-optimised fast path.
 *
 * Strategy:
 *   1. Try /runsync first — with FlashBoot enabled, warm workers respond in
 *      seconds and we skip all polling overhead.
 *   2. If /runsync returns a queued/in-progress status (cold start or busy),
 *      fall back to /run + /status/{id} polling.
 *   3. Poll aggressively (1s) for the first 10s (FlashBoot cold start), then
 *      back off to 3s.
 */

type RunPodEnvelope<T> = {
  id?: string;
  status?:
    | "IN_QUEUE"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "FAILED"
    | "TIMED_OUT"
    | "CANCELLED";
  output?: T;
  error?: string;
};

export type RunPodCallOptions = {
  /** Max wall-clock to wait for completion, ms. Default 20 min. */
  timeoutMs?: number;
  /** Optional label for log lines. */
  label?: string;
};

function baseUrl(endpoint: string): string {
  return endpoint.replace(/\/(runsync|run)\/?$/, "");
}

/**
 * Invoke a RunPod serverless endpoint and return the output.
 *
 * @param endpointUrl Endpoint URL (can end in /runsync, /run, or bare).
 * @param apiKey      Bearer token.
 * @param input       The handler input payload.
 * @returns           The handler's `output` field.
 */
export async function callRunPodAsync<TInput, TOutput>(
  endpointUrl: string,
  apiKey: string,
  input: TInput,
  options: RunPodCallOptions = {},
): Promise<TOutput> {
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
  const label = options.label ?? "runpod";
  const base = baseUrl(endpointUrl);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const body = JSON.stringify({ input });

  // ── Fast path: /runsync ────────────────────────────────────────────
  try {
    const syncRes = await fetch(`${base}/runsync`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(90_000), // 90s ceiling for runsync
    });
    if (syncRes.ok) {
      const env = (await syncRes.json()) as RunPodEnvelope<TOutput>;

      if (env.status === "COMPLETED" && env.output !== undefined) {
        checkHandlerError(env.output, label);
        return env.output;
      }

      if (env.status === "FAILED" || env.status === "TIMED_OUT" || env.status === "CANCELLED") {
        throw new Error(`RunPod ${label} ${env.status}: ${env.error ?? "no error message"}`);
      }

      // Got a queued/in-progress envelope — fall through to polling with
      // the job id we already have.
      if (env.id) {
        return pollForResult<TOutput>(base, env.id, headers, label, timeoutMs, Date.now());
      }
    }
    // Non-200 or no id — fall through to /run.
  } catch (err) {
    // Timeout or network glitch on /runsync — fall through to /run.
    if (!(err instanceof Error && err.name === "AbortError")) {
      // Unexpected error that isn't a timeout — still try /run.
    }
  }

  // ── Slow path: /run + poll ─────────────────────────────────────────
  const startRes = await fetch(`${base}/run`, {
    method: "POST",
    headers,
    body,
  });
  if (!startRes.ok) {
    const text = await startRes.text().catch(() => "");
    throw new Error(`RunPod ${label} /run -> ${startRes.status}: ${text.slice(0, 500)}`);
  }
  const startEnv = (await startRes.json()) as RunPodEnvelope<TOutput>;
  if (!startEnv.id) {
    if (startEnv.status === "COMPLETED" && startEnv.output !== undefined) {
      checkHandlerError(startEnv.output, label);
      return startEnv.output;
    }
    throw new Error(
      `RunPod ${label} /run returned no job id: ${JSON.stringify(startEnv).slice(0, 500)}`,
    );
  }

  return pollForResult<TOutput>(base, startEnv.id, headers, label, timeoutMs, Date.now());
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Adaptive-interval polling: 1s for the first 10s, then 3s. */
async function pollForResult<T>(
  base: string,
  jobId: string,
  headers: Record<string, string>,
  label: string,
  timeoutMs: number,
  startedAt: number,
): Promise<T> {
  const deadline = startedAt + timeoutMs;

  while (Date.now() < deadline) {
    const elapsed = Date.now() - startedAt;
    const interval = elapsed < 10_000 ? 1000 : 3000;
    await new Promise((r) => setTimeout(r, interval));

    const sRes = await fetch(`${base}/status/${jobId}`, { headers });
    if (!sRes.ok) {
      const text = await sRes.text().catch(() => "");
      throw new Error(`RunPod ${label} /status -> ${sRes.status}: ${text.slice(0, 500)}`);
    }
    const env = (await sRes.json()) as RunPodEnvelope<T>;

    if (env.status === "COMPLETED") {
      if (env.output === undefined) {
        throw new Error(`RunPod ${label} COMPLETED with no output`);
      }
      checkHandlerError(env.output, label);
      return env.output;
    }
    if (env.status === "FAILED" || env.status === "TIMED_OUT" || env.status === "CANCELLED") {
      throw new Error(`RunPod ${label} ${env.status}: ${env.error ?? "no error message"}`);
    }
  }
  throw new Error(`RunPod ${label} did not complete in ${timeoutMs}ms`);
}

function checkHandlerError<T>(output: T, label: string): void {
  const out = output as T & { error?: string };
  if (out && typeof out === "object" && out.error) {
    throw new Error(`RunPod ${label} handler error: ${out.error}`);
  }
}
