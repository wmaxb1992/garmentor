/**
 * Shared async RunPod invocation: POST /run (queue), then poll /status/{id}.
 *
 * Why not /runsync: it has a hard server-side timeout (typically ~5 min on
 * RunPod). Our cold starts download multi-GB model weights and can run 10-15
 * min on first request, which exceeds /runsync. The /run + poll pattern
 * survives any cold-start duration without leaking partial responses to
 * the client (which manifested as "RunPod response missing gcd.pattern.panels"
 * when /runsync returned a job-status envelope instead of an output).
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
  /** Polling interval after the first hit, ms. Default 4 s. */
  pollIntervalMs?: number;
  /** Optional label for log lines. */
  label?: string;
};

/**
 * Invoke a RunPod serverless endpoint and return the output.
 *
 * @param runsyncUrl Endpoint URL ending in `/runsync` (we swap to /run + /status).
 * @param apiKey     Bearer token.
 * @param input      The handler input payload.
 * @returns          The handler's `output` field.
 */
export async function callRunPodAsync<TInput, TOutput>(
  runsyncUrl: string,
  apiKey: string,
  input: TInput,
  options: RunPodCallOptions = {},
): Promise<TOutput> {
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 4000;
  const label = options.label ?? "runpod";

  // Swap the /runsync suffix to /run and /status/{id}. If the URL doesn't
  // end with /runsync, assume it's already the base.
  const base = runsyncUrl.replace(/\/runsync\/?$/, "");
  const runUrl = `${base}/run`;
  const statusBase = `${base}/status`;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // 1. Enqueue.
  const startRes = await fetch(runUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
  });
  if (!startRes.ok) {
    const text = await startRes.text().catch(() => "");
    throw new Error(
      `RunPod ${label} /run -> ${startRes.status}: ${text.slice(0, 500)}`,
    );
  }
  const startEnv = (await startRes.json()) as RunPodEnvelope<TOutput>;
  if (!startEnv.id) {
    if (startEnv.status === "COMPLETED" && startEnv.output !== undefined) {
      return startEnv.output;
    }
    throw new Error(
      `RunPod ${label} /run returned no job id: ${JSON.stringify(startEnv).slice(0, 500)}`,
    );
  }
  const jobId = startEnv.id;

  // 2. Poll until terminal.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const sRes = await fetch(`${statusBase}/${jobId}`, { headers });
    if (!sRes.ok) {
      const text = await sRes.text().catch(() => "");
      throw new Error(
        `RunPod ${label} /status -> ${sRes.status}: ${text.slice(0, 500)}`,
      );
    }
    const env = (await sRes.json()) as RunPodEnvelope<TOutput>;
    if (env.status === "COMPLETED") {
      if (env.output === undefined) {
        throw new Error(`RunPod ${label} COMPLETED with no output`);
      }
      const out = env.output as TOutput & { error?: string };
      if (out && typeof out === "object" && out.error) {
        throw new Error(`RunPod ${label} handler error: ${out.error}`);
      }
      return env.output;
    }
    if (
      env.status === "FAILED" ||
      env.status === "TIMED_OUT" ||
      env.status === "CANCELLED"
    ) {
      throw new Error(
        `RunPod ${label} ${env.status}: ${env.error ?? "no error message"}`,
      );
    }
    // else: IN_QUEUE | IN_PROGRESS — keep polling.
  }
  throw new Error(`RunPod ${label} did not complete in ${timeoutMs}ms`);
}
