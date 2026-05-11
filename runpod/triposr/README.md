# TripoSR on RunPod Serverless

Self-hosted replacement for Hunyuan3D-2. Produces a textured GLB from a single image in ~1–3 s warm.

## Build (auto, via GH Actions)

The `.github/workflows/build-runpod.yml` matrix builds this image to `ghcr.io/<owner>/garmentor-3d:latest` whenever this folder changes.

## Deploy

`scripts/runpod-create-endpoints.ts` creates the Serverless endpoint and writes `RUNPOD_GENERATE_ENDPOINT_URL` into `.env.local`.

## Request

```json
{
  "input": {
    "image": "<base64 png>",
    "remove_background": true,
    "mc_resolution": 256
  }
}
```

## Response

```json
{ "output": { "glb": "<base64>", "vertices": 12345, "faces": 23456 } }
```

## Why TripoSR over Hunyuan3D-2 / TRELLIS

- ~600 MB checkpoint vs. 10+ GB → cold start is minutes not tens-of-minutes.
- 1–3 s warm inference on RTX 4090.
- Good enough for the design-visualization use case (Garmentor uses GarmentGPT for the actual sewing pattern; the mesh is for preview and panel-shape validation).
