# GarmentGPT on RunPod Serverless

Wraps [ChimerAI/GarmentGPT](https://huggingface.co/ChimerAI/GarmentGPT) for pattern generation. One handler, one Dockerfile.

## Build

1. Place the Garment-GPT source next to this Dockerfile:

   ```bash
   cd runpod/garment-gpt
   cp -R /path/to/Garment-GPT-main ./garment-gpt-src
   ```

2. Build + push:

   ```bash
   docker build -t YOUR_DOCKERHUB/garmentor-pattern:latest .
   docker push YOUR_DOCKERHUB/garmentor-pattern:latest
   ```

   First build is slow (downloads PyTorch wheels, vLLM, then the ~10–20 GB HuggingFace checkpoint). Subsequent rebuilds use the layer cache.

## Deploy

RunPod Console → Serverless → New Endpoint:

- **Docker Image**: your pushed tag
- **GPU**: RTX 4090 or A100 (≥24 GB VRAM)
- **Min Workers**: 0 (scale-to-zero)
- **Max Workers**: 5
- **FlashBoot**: ✅
- **Idle Timeout**: 5 s

Copy the `runsync` URL (e.g. `https://api.runpod.ai/v2/<endpoint-id>/runsync`) into your `.env.local` as `RUNPOD_PATTERN_ENDPOINT_URL`.

## Request / response shape

```json
POST {RUNPOD_PATTERN_ENDPOINT_URL}
Authorization: Bearer {RUNPOD_API_KEY}

{
  "input": {
    "image": "<base64>",
    "media_type": "image/png"
  }
}
```

```json
{
  "id": "...",
  "status": "COMPLETED",
  "output": {
    "gcd": {
      "pattern": { "panels": { ... }, "stitches": [...], "panel_order": [...] },
      "properties": { "units_in_meter": 100, ... }
    },
    "model": "GarmentGPT"
  }
}
```

## Notes

- `units_in_meter: 100` means panel vertices are in centimeters. The Next.js DXF writer converts to mm/cm/inches at export time.
- Inference time: 30–90 s on a cold worker, 5–15 s warm.
- If you skip baking the checkpoints into the image, set `HF_TOKEN` as a RunPod secret so the handler can download from HuggingFace at first run.
