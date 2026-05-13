"""RunPod Serverless handler for image-to-image garment editing.

Default model: SDXL Turbo (`stabilityai/sdxl-turbo`) — ungated, MIT-style
license, 1-4 step distilled. To switch back to FLUX.1-schnell, set env
`EDIT_MODEL_ID=black-forest-labs/FLUX.1-schnell` and supply HF_TOKEN since
that repo is gated.

input:
  image:        base64 PNG/JPEG bytes
  media_type:   e.g. "image/png" (optional)
  instruction:  natural language edit instruction
  steps:        int, optional (defaults to 4)
  strength:     float 0-1, optional (defaults to 0.85)

output:
  image:        base64 PNG bytes of the edited image
  media_type:   "image/png"
"""

from __future__ import annotations

import base64
import io
import os
from typing import Any, Dict

import runpod
import torch
from PIL import Image


# Default to local baked-in weights; fall back to HF model ID for FLUX.
MODEL_ID = os.environ.get(
    "EDIT_MODEL_ID",
    os.environ.get("FLUX_MODEL_ID", "/workspace/models/sdxl-turbo"),
)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.float16


_pipe = None  # type: ignore[var-annotated]


def _get_pipe():
    global _pipe
    if _pipe is None:
        import time

        # Lazy import — diffusers + the right pipeline class for the model.
        if "flux" in MODEL_ID.lower():
            from diffusers import FluxImg2ImgPipeline as PipeClass
            dtype = torch.bfloat16
        else:
            # SDXL / SDXL-Turbo image-to-image
            from diffusers import AutoPipelineForImage2Image as PipeClass
            dtype = DTYPE

        # Retry model download up to 3 times — HuggingFace can be flaky on
        # cold-start workers that haven't cached the weights yet.
        last_err = None
        for attempt in range(3):
            try:
                _pipe = PipeClass.from_pretrained(
                    MODEL_ID,
                    torch_dtype=dtype,
                    variant="fp16" if dtype == torch.float16 else None,
                )
                break
            except Exception as e:
                last_err = e
                wait = 5 * (attempt + 1)
                print(f"[edit] model load attempt {attempt+1} failed: {e}. "
                      f"Retrying in {wait}s...", flush=True)
                time.sleep(wait)
        else:
            raise RuntimeError(
                f"Failed to load {MODEL_ID} after 3 attempts: {last_err}"
            ) from last_err

        _pipe.to(DEVICE)
        _pipe.set_progress_bar_config(disable=True)
    return _pipe


def _decode_image(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def _encode_image(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def handler(event: Dict[str, Any]) -> Dict[str, Any]:
    inp = event.get("input") or {}
    image_b64 = inp.get("image")
    instruction = inp.get("instruction")
    if not image_b64 or not instruction:
        return {"error": "input.image and input.instruction are required"}

    try:
        src = _decode_image(image_b64)
        # SDXL Turbo expects 512x512 input typically; we keep aspect & cap.
        max_side = 768
        w, h = src.size
        if max(w, h) > max_side:
            scale = max_side / max(w, h)
            src = src.resize((int(w * scale), int(h * scale)))
    except Exception as e:
        return {"error": f"Failed to decode image: {e!s}"}

    steps = int(inp.get("steps") or 4)
    strength = float(inp.get("strength") or 0.85)

    try:
        pipe = _get_pipe()
        kwargs: Dict[str, Any] = dict(
            prompt=instruction,
            image=src,
            num_inference_steps=steps,
            strength=strength,
        )
        # FLUX uses guidance_scale=0, SDXL Turbo uses ~0.0 too. Both fine.
        kwargs["guidance_scale"] = 0.0
        out = pipe(**kwargs)
        edited = out.images[0]
    except Exception as e:
        return {"error": f"Edit failed ({MODEL_ID}): {e!s}"}

    return {"image": _encode_image(edited), "media_type": "image/png", "model": MODEL_ID}


runpod.serverless.start({"handler": handler})
