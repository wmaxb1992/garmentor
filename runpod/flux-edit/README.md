# FLUX.1-schnell image edit on RunPod Serverless

Self-hosted replacement for the Modal-hosted edit endpoint. Used by the `edit_garment_image` tool in chat to apply natural-language edits (e.g. "change patch pockets to welt pockets") to a garment photo before generating a pattern.

## Build

```bash
cd runpod/flux-edit
docker build -t YOUR_DOCKERHUB/garmentor-flux-edit:latest .
docker push YOUR_DOCKERHUB/garmentor-flux-edit:latest
```

## Deploy

RunPod Console → Serverless → New Endpoint:

- **Docker Image**: your pushed tag
- **GPU**: RTX 4090 (24 GB) — sufficient for schnell at bfloat16
- **Min Workers**: 0
- **Max Workers**: 3
- **FlashBoot**: ✅
- **Idle Timeout**: 10 s

Copy the `runsync` URL into `.env.local`:

```bash
RUNPOD_EDIT_ENDPOINT_URL=https://api.runpod.ai/v2/<endpoint-id>/runsync
```

## Request shape

```json
{
  "input": {
    "image": "<base64>",
    "media_type": "image/png",
    "instruction": "change patch pockets to welt pockets",
    "steps": 4,
    "strength": 0.85
  }
}
```

Output:

```json
{ "output": { "image": "<base64 PNG>", "media_type": "image/png" } }
```

## Why schnell over dev

- 4-step distilled → ~1.5 s warm inference vs ~10 s for FLUX-dev.
- Apache 2.0 license, fully self-hostable.
- Quality is good enough for design iteration; switch to `FLUX.1-dev` by changing the `FLUX_MODEL_ID` env var if you need the extra fidelity.
