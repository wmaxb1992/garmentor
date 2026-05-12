/**
 * Shared RunPod invocation — /runsync only, no polling.
 *
 * We exclusively use /runsync because:
 *   - All endpoints have workersMin≥1 (warm workers), so /runsync completes
 *     in-band for the vast majority of requests.
 *   - Cloudflare Workers have a 50-subrequest limit per invocation. A single
 *     polling loop can burn 20+ subrequests, and the chat route may invoke
 *     multiple tools per step across up to 4 steps — easily exceeding 50.
 *   - With FlashBoot enabled, even cold starts resolve within ~30s.
 *
 * If /runsync times out (worker overloaded or GPU throttled), we surface the
 * error immediately rather than silently consuming subrequests with polling.
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
  /** Max wall-clock to wait for /runsync, ms. Default 5 min. */
  timeoutMs?: number;
  /** Optional label for log lines. */
  label?: string;
};

function baseUrl(endpoint: string): string {
  return endpoint.replace(/\/(runsync|run)\/?$/, "");
}

/**
 * Invoke a RunPod serverless endpoint via /runsync and return the output.
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
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000; // 5 min default
  const label = options.label ?? "runpod";
  const base = baseUrl(endpointUrl);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const body = JSON.stringify({ input });

  // ── Single /runsync call — no polling ──────────────────────────────
  const syncRes = await fetch(`${base}/runsync`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!syncRes.ok) {
    const text = await syncRes.text().catch(() => "");
    throw new Error(`RunPod ${label} /runsync -> ${syncRes.status}: ${text.slice(0, 500)}`);
  }

  const env = (await syncRes.json()) as RunPodEnvelope<TOutput>;

  if (env.status === "COMPLETED" && env.output !== undefined) {
    checkHandlerError(env.output, label);
    return env.output;
  }

  if (env.status === "FAILED" || env.status === "TIMED_OUT" || env.status === "CANCELLED") {
    throw new Error(`RunPod ${label} ${env.status}: ${env.error ?? "no error message"}`);
  }

  // /runsync returned IN_QUEUE or IN_PROGRESS — worker wasn't available.
  // Don't poll (Cloudflare subrequest limit); surface the error immediately.
  throw new Error(
    `RunPod ${label} worker unavailable (status: ${env.status ?? "unknown"}). ` +
    `The endpoint may be scaling up — try again in a few seconds.`,
  );
}

function checkHandlerError<T>(output: T, label: string): void {
  const out = output as T & { error?: string };
  if (out && typeof out === "object" && out.error) {
    throw new Error(`RunPod ${label} handler error: ${out.error}`);
  }
}
