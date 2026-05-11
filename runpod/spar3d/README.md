# SPAR3D on RunPod Serverless

Image → textured 3D garment mesh via Stability AI's **Stable Point-Aware Reconstruction in 3D**. Replaces the earlier TripoSR-based handler.

## Why SPAR3D over TripoSR

- Substantially better **back-side** fidelity (point-cloud guided diffusion → fills in what the photo can't show).
- Sharper texture maps → `lib/seam-detect.ts` luminance sampling auto-detects more real seams.
- 5–10 s warm inference vs TripoSR's 1–3 s — slower, but not real-time critical for Garmentor.

## Build (auto)

`.github/workflows/build-runpod.yml` builds this image to `ghcr.io/<owner>/garmentor-3d:latest` whenever this folder changes.

## Deploy

`scripts/runpod-create-endpoints.ts` provisions a Serverless endpoint, image `garmentor-3d`. Writes `RUNPOD_GENERATE_ENDPOINT_URL` into `.env.local`.

## Request

```json
{
  "input": {
    "image": "<base64 png>",
    "remove_background": true,
    "texture_resolution": 1024
  }
}
```

## Response

```json
{ "output": { "glb": "<base64>", "vertices": 12345, "faces": 23456, "model": "stabilityai/stable-point-aware-3d" } }
```

## License

Stability Community License — free for non-commercial use and for companies under $1M revenue. Beyond that threshold, a paid commercial license from Stability AI is required. See <https://huggingface.co/stabilityai/stable-point-aware-3d> for terms.
