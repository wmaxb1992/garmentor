"""Modal app: instruction-driven image edit using Qwen-Image-Edit-2509.

Deploy:
    modal deploy modal/edit.py

Then copy the printed `QwenImageEditService.edit` URL into MODAL_EDIT_URL
in `.env.local` of the Next.js app.

Notes:
- Independent app from `modal/app.py` (Hunyuan3D-2). Separate deploy lifecycle.
- First deploy downloads ~40 GB of weights into the shared HF cache volume;
  expect 15-30 min. Subsequent deploys are seconds.
- Cold start is 60-90s while weights load to GPU. Warm calls run 6-12s on L40S.
- Model card: https://huggingface.co/Qwen/Qwen-Image-Edit-2509 (Apache 2.0).
"""

from __future__ import annotations

import io
import os
from pathlib import Path

import modal

APP_NAME = "garmentor-edit"
HF_REPO = "Qwen/Qwen-Image-Edit-2509"
CACHE_DIR = "/cache"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.7.0",
        "torchvision==0.22.0",
        "diffusers==0.38.0",
        "transformers==5.8.0",
        "accelerate>=1.1.0",
        "huggingface_hub[hf_transfer]>=1.5.0,<2.0",
        "pillow==11.0.0",
        "fastapi[standard]==0.115.5",
        "sentencepiece==0.2.0",
        "protobuf==5.28.3",
        extra_options="--extra-index-url https://download.pytorch.org/whl/cu128",
    )
    .env(
        {
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            "HF_HOME": f"{CACHE_DIR}/hf",
        }
    )
)

cache_volume = modal.Volume.from_name(
    "garmentor-hf-cache", create_if_missing=True
)

app = modal.App(APP_NAME, image=image)

with image.imports():
    from fastapi import Request

AUTH_TOKEN_SECRET = modal.Secret.from_dict(
    {"MODAL_AUTH_TOKEN": os.environ.get("MODAL_AUTH_TOKEN", "")}
)


@app.cls(
    gpu="H100",
    volumes={CACHE_DIR: cache_volume},
    timeout=600,
    scaledown_window=180,
    secrets=[AUTH_TOKEN_SECRET],
    max_containers=2,
)
class QwenImageEditService:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import QwenImageEditPlusPipeline

        self.torch = torch
        Path(CACHE_DIR).mkdir(parents=True, exist_ok=True)
        self.pipe = QwenImageEditPlusPipeline.from_pretrained(
            HF_REPO,
            torch_dtype=torch.bfloat16,
            cache_dir=f"{CACHE_DIR}/hf",
        )
        self.pipe.to("cuda")
        self.pipe.set_progress_bar_config(disable=True)
        cache_volume.commit()

    @modal.fastapi_endpoint(method="POST", docs=True)
    async def edit(self, request: Request):
        return await self._handle(request)

    async def _handle(self, request):
        from fastapi import HTTPException, Response
        from PIL import Image as PILImage

        expected = os.environ.get("MODAL_AUTH_TOKEN", "").strip()
        if expected:
            auth = request.headers.get("authorization", "")
            if auth != f"Bearer {expected}":
                raise HTTPException(status_code=401, detail="unauthorized")

        form = await request.form()
        upload = form.get("image")
        instruction = form.get("instruction")
        if upload is None:
            raise HTTPException(status_code=400, detail="missing `image` field")
        if not instruction or not str(instruction).strip():
            raise HTTPException(
                status_code=400, detail="missing `instruction` field"
            )

        steps_raw = form.get("steps")
        try:
            steps = int(steps_raw) if steps_raw else 40
        except (TypeError, ValueError):
            steps = 40
        steps = max(10, min(steps, 60))

        seed_raw = form.get("seed")
        try:
            seed = int(seed_raw) if seed_raw else 0
        except (TypeError, ValueError):
            seed = 0

        raw = await upload.read()
        img = PILImage.open(io.BytesIO(raw)).convert("RGB")

        generator = self.torch.Generator(device="cuda").manual_seed(seed)
        with self.torch.inference_mode():
            output = self.pipe(
                image=[img],
                prompt=str(instruction),
                generator=generator,
                true_cfg_scale=4.0,
                negative_prompt=" ",
                num_inference_steps=steps,
                guidance_scale=1.0,
                num_images_per_prompt=1,
            )
        edited = output.images[0]

        out = io.BytesIO()
        edited.save(out, format="PNG")
        out.seek(0)

        return Response(
            content=out.getvalue(),
            media_type="image/png",
            headers={"Content-Disposition": 'attachment; filename="edited.png"'},
        )
