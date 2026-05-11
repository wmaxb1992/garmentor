# Deploy Garmentor to RunPod

Three endpoints, two of them automated, all four URLs land in `.env.local`.

## What gets deployed

| Endpoint | Type | Auto? | Image source |
|---|---|---|---|
| `garmentor-pattern` (GarmentGPT) | Serverless | ✅ via script | GHCR (built by GH Actions) |
| `garmentor-flux-edit` (FLUX.1-schnell) | Serverless | ✅ via script | GHCR (built by GH Actions) |
| chat VLM (Qwen2.5-VL-7B) | Serverless vLLM | ⚠️ UI Quick Deploy | RunPod's stock vLLM template |
| 3D mesh (TripoSR / TRELLIS) | Serverless | follow `runpod/RUNPOD_SETUP.md` | already-built (if you set it up earlier) |

## Step 1 — Push to GitHub (triggers Actions to build images)

```bash
git add .
git commit -m "RunPod-only inference pipeline"
git push
```

Watch the build at <https://github.com/wmaxb1992/garmentor/actions>. Both jobs take ~10 minutes the first time.

When it's green, images are at:
- `ghcr.io/wmaxb1992/garmentor-pattern:latest`
- `ghcr.io/wmaxb1992/garmentor-flux-edit:latest`

If GHCR shows the packages as **private** (default), make them public so RunPod can pull without credentials:

```bash
gh api -X PATCH /user/packages/container/garmentor-pattern --field visibility=public
gh api -X PATCH /user/packages/container/garmentor-flux-edit --field visibility=public
```

## Step 2 — Run the deploy script

Get a RunPod API key at <https://www.runpod.io/console/user/settings>.

```bash
export RUNPOD_API_KEY=rpa_XXXXXXXXXXXX
bun scripts/runpod-create-endpoints.ts
```

This calls RunPod's REST API and:
- Creates `garmentor-pattern` and `garmentor-flux-edit` Serverless endpoints (Min Workers: 0, FlashBoot: ✅)
- Writes the resulting URLs + your API key into `.env.local`

It's idempotent — re-running just prints the existing endpoint IDs.

## Step 3 — Deploy the chat VLM (UI, one-time)

1. <https://www.runpod.io/console/serverless/user/endpoints> → **New Endpoint**
2. Pick **Serverless vLLM** (Quick Deploy)
3. Hugging Face Model: `Qwen/Qwen2.5-VL-7B-Instruct`
4. GPU: any 24 GB+ (RTX 4090 / L40S / A100)
5. Max Model Length: `16384`
6. Enable Auto Tool Choice ✅ → parser `hermes`
7. Min Workers: `0`, FlashBoot ✅, Idle Timeout: `5s`
8. Deploy → copy the OpenAI URL (looks like `https://api.runpod.ai/v2/<id>/openai/v1`)

Append it to `.env.local`:

```bash
echo "RUNPOD_CHAT_BASE_URL=https://api.runpod.ai/v2/<id>/openai/v1" >> .env.local
```

## Step 4 — Deploy 3D mesh (optional, if not already set up)

Follow `runpod/RUNPOD_SETUP.md` (predates this migration). The endpoint URL goes into `.env.local` as `RUNPOD_GENERATE_ENDPOINT_URL`.

## Run

```bash
bun run dev
```

First request to each endpoint cold-starts the worker (5–15 min for the weight download). After that, warm calls are 5–15 s.

## Cost guardrails

- **Min Workers: 0** on all three serverless endpoints → no charges while idle.
- The Quick Deploy chat endpoint defaults to the same setting.
- Each run-of-the-mill chat turn is <$0.05. Pattern generation is $0.05–0.15.
- Set a RunPod spending limit at <https://www.runpod.io/console/user/billing>.
