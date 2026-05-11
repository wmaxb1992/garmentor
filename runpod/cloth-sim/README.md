# Cloth sim on RunPod (NVIDIA Warp)

Takes a GCD pattern + optional avatar mesh and produces a draped 3D garment with fit metrics (stretch / compression / mean stretch ratio).

## Request

```json
{
  "input": {
    "cloth_input": { /* output of buildClothInput() from lib/stitch-graph.ts */ },
    "avatar_glb": "<base64 GLB of body mesh>",
    "fabric": "denim",
    "substeps": 80,
    "gravity": [0, -9.81, 0]
  }
}
```

## Response

```json
{
  "output": {
    "draped_glb": "<base64 GLB>",
    "metrics": {
      "maxStretch": 1.18,
      "maxCompression": 0.78,
      "meanStretch": 0.99
    }
  }
}
```

Interpretation:
- `maxStretch > 1.15` → fabric is pulling (a panel is too small).
- `maxCompression < 0.85` → fabric is bunching (a panel is too big or seams too long).

## Costs

- ~50–150 GPU-seconds per drape (substeps=80, ~5k particles).
- Min Workers: 0 → $0 idle. ~$0.02–0.05 per drape on RTX 4090.
