"""RunPod Serverless handler for GarmentGPT.

Wraps the upstream `main.py` GarmentPredictor and exposes a single-call API:

    input:
      image: base64-encoded PNG/JPEG/WebP bytes
      media_type: e.g. "image/png" (optional, defaults to image/png)

    output:
      gcd: the GCD-format pattern dict (panels, edges, stitches, properties)

The model is loaded once at module import and held in a global; RunPod
serverless workers reuse the same Python process across invocations until
they're scaled down.
"""

from __future__ import annotations

import base64
import io
import os
import tempfile
import traceback
from typing import Any, Dict

import runpod
from PIL import Image

# Upstream Garment-GPT lives at /workspace/garment-gpt in the Docker image.
import sys

sys.path.insert(0, "/workspace/garment-gpt")

# Defer `from main import GarmentPredictor` until the first request — its
# transitive imports (vllm, llamafactory, transformers, torch.cuda init)
# can take 30+ seconds and abort the whole worker if anything's mismatched.
# Importing lazily means the worker reaches ready quickly and any crash
# shows up as a clean job error instead of a worker crash-loop.
GarmentPredictor = None  # type: ignore[assignment]


CHECKPOINT_DIR = os.environ.get("GARMENT_GPT_CHECKPOINTS", "/workspace/checkpoints")
LLM_PATH = os.path.join(CHECKPOINT_DIR, "vlm", "checkpoint-12844")


def _ensure_checkpoints() -> None:
    """Download ChimerAI/GarmentGPT into CHECKPOINT_DIR on first call.

    Only downloads inference-time files — skips DeepSpeed optimizer states,
    training artifacts, and RNG states that add ~50 GB of unnecessary data.
    """
    # Use v2 marker — v1 downloaded everything including ~50 GB of optimizer
    # states. If only the old marker exists, re-download selectively.
    marker = os.path.join(CHECKPOINT_DIR, ".downloaded_v2")
    if os.path.exists(marker):
        return

    # Clean stale v1 marker so we don't skip re-download.
    old_marker = os.path.join(CHECKPOINT_DIR, ".downloaded")
    if os.path.exists(old_marker):
        os.remove(old_marker)

    os.makedirs(CHECKPOINT_DIR, exist_ok=True)
    import time
    from huggingface_hub import snapshot_download

    last_err = None
    for attempt in range(3):
        try:
            snapshot_download(
                repo_id="ChimerAI/GarmentGPT",
                local_dir=CHECKPOINT_DIR,
                max_workers=8,
                ignore_patterns=[
                    "*/global_step*/*",       # DeepSpeed optimizer states (~50 GB)
                    "*/rng_state_*.pth",      # Per-rank RNG states
                    "*/scheduler.pt",         # LR scheduler state
                    "*/trainer_state.json",   # Trainer bookkeeping
                    "*/training_args.bin",    # Training arguments
                    "*/zero_to_fp32.py",      # DeepSpeed conversion script
                    "*/latest",               # DeepSpeed checkpoint pointer
                ],
            )
            break
        except Exception as e:
            last_err = e
            wait = 10 * (attempt + 1)
            print(f"[handler] checkpoint download attempt {attempt+1} failed: {e}. "
                  f"Retrying in {wait}s...", flush=True)
            time.sleep(wait)
    else:
        raise RuntimeError(
            f"Failed to download checkpoints after 3 attempts: {last_err}"
        ) from last_err

    # Verify the safetensors exist before marking as done.
    expected = os.path.join(
        CHECKPOINT_DIR, "vlm", "checkpoint-12844",
        "model-00001-of-00003.safetensors",
    )
    if not os.path.exists(expected):
        raise RuntimeError(
            f"Download appeared to succeed but {expected} is missing"
        )
    with open(marker, "w") as f:
        f.write("ok")
CODEC_CONFIG = "/workspace/garment-gpt/configs/config_vq1024_resres_aug_decay0.99_q5_gcd_nl8_ld512.yaml"
RT_CONFIG = "/workspace/garment-gpt/configs/config_rt_euler.yaml"
DEVICE = os.environ.get("GARMENT_GPT_DEVICE", "cuda:0")


_predictor = None  # type: ignore[var-annotated]


def _get_predictor():
    global _predictor, GarmentPredictor
    if _predictor is None:
        _ensure_checkpoints()
        if GarmentPredictor is None:
            from main import GarmentPredictor as _GP  # type: ignore
            GarmentPredictor = _GP  # type: ignore[assignment]
        _predictor = GarmentPredictor(
            llm_model_path=LLM_PATH,
            codec_config_path=CODEC_CONFIG,
            rt_config_path=RT_CONFIG,
            device=DEVICE,
        )
    return _predictor


def _decode_image(b64: str, media_type: str) -> str:
    """Decode base64 image into a temp file and return its path.

    GarmentPredictor.predict() expects a filesystem path, so we materialize
    the bytes once per request. The temp file is cleaned up after inference.
    """
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    suffix = ".png"
    if "jpeg" in media_type or "jpg" in media_type:
        suffix = ".jpg"
    elif "webp" in media_type:
        suffix = ".webp"
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="garmentor-")
    os.close(fd)
    img.save(path)
    return path


def handler(event: Dict[str, Any]) -> Dict[str, Any]:
    inp = event.get("input") or {}
    image_b64 = inp.get("image")
    if not image_b64:
        return {"error": "input.image (base64) is required"}
    media_type = inp.get("media_type", "image/png")

    try:
        image_path = _decode_image(image_b64, media_type)
    except Exception as e:
        return {"error": f"Failed to decode image: {e!s}"}

    try:
        predictor = _get_predictor()
        gcd = predictor.predict(image_path=image_path)
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[handler] GarmentGPT error:\n{tb}", flush=True)
        return {"error": f"GarmentGPT inference failed: {e!s}", "traceback": tb}
    finally:
        try:
            os.unlink(image_path)
        except OSError:
            pass

    if not gcd:
        return {"error": "GarmentGPT returned no result"}
    return {"gcd": gcd, "model": "GarmentGPT"}


runpod.serverless.start({"handler": handler})
