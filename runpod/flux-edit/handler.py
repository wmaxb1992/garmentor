"""RunPod Serverless handler for FLUX.1-schnell image-to-image editing.

input:
  image:        base64 PNG/JPEG bytes
  media_type:   e.g. "image/png" (optional)
  instruction:  natural language edit instruction
  steps:        int, optional (defaults to 4 — schnell is a 4-step distilled model)
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
from diffusers import FluxImg2ImgPipeline
from PIL import Image


MODEL_ID = os.environ.get("FLUX_MODEL_ID", "black-forest-labs/FLUX.1-schnell")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16


_pipe: FluxImg2ImgPipeline | None = None


def _get_pipe() -> FluxImg2ImgPipeline:
    global _pipe
    if _pipe is None:
        _pipe = FluxImg2ImgPipeline.from_pretrained(MODEL_ID, torch_dtype=DTYPE)
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
    except Exception as e:
        return {"error": f"Failed to decode image: {e!s}"}

    steps = int(inp.get("steps") or 4)
    strength = float(inp.get("strength") or 0.85)

    try:
        pipe = _get_pipe()
        out = pipe(
            prompt=instruction,
            image=src,
            num_inference_steps=steps,
            strength=strength,
            guidance_scale=0.0,  # schnell uses guidance_scale=0
        )
        edited = out.images[0]
    except Exception as e:
        return {"error": f"FLUX edit failed: {e!s}"}

    return {"image": _encode_image(edited), "media_type": "image/png"}


runpod.serverless.start({"handler": handler})
