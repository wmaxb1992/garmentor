"""RunPod Serverless handler for TripoSR (image -> 3D mesh).

input:
  image:        base64 PNG/JPEG bytes
  media_type:   optional, e.g. "image/png"
  remove_background:  bool, default True
  mc_resolution:      int, default 256 (Marching Cubes resolution; 128-512)

output:
  glb:          base64 GLB bytes
  vertices:     int
  faces:        int
"""

from __future__ import annotations

import base64
import io
import os
from typing import Any, Dict

import runpod
import numpy as np
import torch
from PIL import Image
from rembg import remove as rembg_remove
from tsr.system import TSR
from tsr.utils import resize_foreground


MODEL_REPO = os.environ.get("TRIPOSR_MODEL", "stabilityai/TripoSR")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

_model: TSR | None = None


def _get_model() -> TSR:
    global _model
    if _model is None:
        m = TSR.from_pretrained(
            MODEL_REPO,
            config_name="config.yaml",
            weight_name="model.ckpt",
        )
        m.renderer.set_chunk_size(8192)
        m.to(DEVICE)
        _model = m
    return _model


def _preprocess(image: Image.Image, remove_bg: bool) -> Image.Image:
    if remove_bg:
        image = rembg_remove(image)
        image = resize_foreground(image, 0.85)
    if image.mode == "RGBA":
        bg = Image.new("RGBA", image.size, (255, 255, 255, 255))
        bg.paste(image, mask=image.split()[3])
        image = bg.convert("RGB")
    return image


def handler(event: Dict[str, Any]) -> Dict[str, Any]:
    inp = event.get("input") or {}
    image_b64 = inp.get("image")
    if not image_b64:
        return {"error": "input.image (base64) is required"}
    remove_bg = bool(inp.get("remove_background", True))
    mc_res = int(inp.get("mc_resolution", 256))

    try:
        raw = base64.b64decode(image_b64)
        src = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception as e:
        return {"error": f"failed to decode image: {e!s}"}

    try:
        prepped = _preprocess(src, remove_bg)
        model = _get_model()
        with torch.no_grad():
            scene_codes = model([prepped], device=DEVICE)
            meshes = model.extract_mesh(scene_codes, resolution=mc_res)
        mesh = meshes[0]
    except Exception as e:
        return {"error": f"inference failed: {e!s}"}

    # Export to GLB in-memory.
    try:
        glb_bytes = mesh.export(file_type="glb")
        if isinstance(glb_bytes, str):
            with open(glb_bytes, "rb") as f:
                glb_bytes = f.read()
    except Exception as e:
        return {"error": f"glb export failed: {e!s}"}

    return {
        "glb": base64.b64encode(glb_bytes).decode("ascii"),
        "vertices": int(len(mesh.vertices)),
        "faces": int(len(mesh.faces)),
    }


runpod.serverless.start({"handler": handler})
