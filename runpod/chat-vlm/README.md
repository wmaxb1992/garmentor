# Chat VLM via RunPod's vLLM Serverless Quick Deploy

We don't build a Docker image for this one. RunPod has a first-class "Serverless vLLM" template that wraps any HuggingFace LLM/VLM with an OpenAI-compatible API, scales to zero, and bills per request — exactly what we need.

## One-time setup (UI)

1. Go to <https://www.runpod.io/console/serverless/user/endpoints>
2. Click **New Endpoint** → **Serverless vLLM** (Quick Deploy)
3. Settings:
   - **Hugging Face Model**: `Qwen/Qwen2.5-VL-7B-Instruct`
   - **GPU**: 24 GB+ (RTX 4090, L40S, or A100)
   - **Max Model Length**: `16384`
   - **Enable Auto Tool Choice**: ✅ (parser: `hermes`)
   - **Min Workers**: `0`
   - **Max Workers**: `3`
   - **FlashBoot**: ✅
   - **Idle Timeout**: `5s`
4. Click **Deploy**

After ~5 min, RunPod shows you an OpenAI-compatible URL of the form:

```
https://api.runpod.ai/v2/<endpoint-id>/openai/v1
```

That's your `RUNPOD_CHAT_BASE_URL`.

## Billing

- $0 when idle (Min Workers: 0)
- ~$0.0004 / second of active GPU time on RTX 4090
- Each chat turn: 1–5 seconds active. Typical session: <$0.05.

## Why not Pods

A long-lived vLLM Pod bills the GPU continuously (~$0.77/hr on RTX 4090) whether you're chatting or not. Serverless vLLM gets you the same OpenAI API surface with scale-to-zero.
