"""RunPod Serverless handler for SPAR3D (Stable Point-Aware Reconstruction 3D).

Image -> 3D mesh (GLB). Replaces the earlier TripoSR-based handler because
SPAR3D has substantially better back-side fidelity, which Garmentor cares
about (the seam-detect texture sampling reads from the mesh).

input:
  image:        base64 PNG/JPEG bytes
  media_type:   optional, e.g. "image/png"
  remove_background:  bool, default True
  texture_resolution: int, default 1024

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
import torch
from PIL import Image


MODEL_ID = os.environ.get("SPAR3D_MODEL_ID", "stabilityai/stable-point-aware-3d")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Defer heavy imports + model load to first request so worker boots fast.
_model = None  # type: ignore[var-annotated]
_remove_background_fn = None  # type: ignore[var-annotated]


def _get_model():
    global _model
    if _model is None:
        # spar3d package lives at /workspace/SPAR3D (added to PYTHONPATH in Dockerfile)
        from spar3d.system import SPAR3D  # type: ignore

        _model = SPAR3D.from_pretrained(
            MODEL_ID,
            config_name="config.yaml",
            weight_name="model.safetensors",
        )
        if hasattr(_model, "renderer") and hasattr(_model.renderer, "set_chunk_size"):
            _model.renderer.set_chunk_size(8192)
        _model.to(DEVICE)
        _model.eval()
    return _model


def _get_bg_remover():
    global _remove_background_fn
    if _remove_background_fn is None:
        from rembg import remove as rembg_remove  # type: ignore

        _remove_background_fn = rembg_remove
    return _remove_background_fn


def _preprocess(image: Image.Image, remove_bg: bool) -> Image.Image:
    if remove_bg:
        image = _get_bg_remover()(image)
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
    tex_res = int(inp.get("texture_resolution", 1024))

    try:
        raw = base64.b64decode(image_b64)
        src = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception as e:
        return {"error": f"failed to decode image: {e!s}"}

    try:
        prepped = _preprocess(src, remove_bg)
        model = _get_model()
        with torch.no_grad():
            # SPAR3D's high-level method varies by checkpoint version; try the
            # documented `run_image` first, fall back to a generic forward.
            if hasattr(model, "run_image"):
                mesh = model.run_image(prepped, texture_resolution=tex_res)
            elif hasattr(model, "generate_mesh"):
                mesh = model.generate_mesh(prepped, texture_resolution=tex_res)
            else:
                raise RuntimeError(
                    "SPAR3D model exposes neither run_image nor generate_mesh",
                )
    except Exception as e:
        return {"error": f"inference failed: {e!s}"}

    # SPAR3D returns either a trimesh.Trimesh or a list — coerce to bytes.
    try:
        if isinstance(mesh, (list, tuple)) and mesh:
            mesh = mesh[0]
        glb_obj = mesh.export(file_type="glb")
        if isinstance(glb_obj, str):
            with open(glb_obj, "rb") as f:
                glb_bytes = f.read()
        else:
            glb_bytes = bytes(glb_obj)
    except Exception as e:
        return {"error": f"glb export failed: {e!s}"}

    return {
        "glb": base64.b64encode(glb_bytes).decode("ascii"),
        "vertices": int(getattr(mesh, "vertices", []).__len__()),
        "faces": int(getattr(mesh, "faces", []).__len__()),
        "model": MODEL_ID,
    }


runpod.serverless.start({"handler": handler})
