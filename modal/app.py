"""Modal app: image -> 3D mesh (.glb) using Hunyuan3D-2.

Deploy:
    modal deploy modal/app.py

Then copy the printed `Hunyuan3DService.generate` URL into MODAL_GENERATE_URL
in `.env.local` of the Next.js app.

Notes:
- First deploy will build CUDA extensions inside the image; expect 15-30 min.
- Cold start of the GPU container is ~30-60s while weights load.
- Warm calls usually complete in 15-40s on an A10G.
"""

from __future__ import annotations

import io
import os
from pathlib import Path

import modal

APP_NAME = "garmentor-mesh"
HF_REPO = "tencent/Hunyuan3D-2"
CACHE_DIR = "/cache"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0", "build-essential", "ninja-build")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "diffusers==0.31.0",
        "transformers==4.46.0",
        "accelerate==1.1.1",
        "huggingface_hub[hf_transfer]==0.26.5",
        "pillow==11.0.0",
        "trimesh==4.5.3",
        "numpy<2",
        "rembg==2.0.59",
        "onnxruntime==1.20.1",
        "fastapi[standard]==0.115.5",
        "einops==0.8.0",
        "omegaconf==2.3.0",
        "scipy==1.14.1",
        extra_options="--extra-index-url https://download.pytorch.org/whl/cu124",
    )
    .run_commands(
        "git clone https://github.com/Tencent/Hunyuan3D-2.git /opt/Hunyuan3D-2",
        "cd /opt/Hunyuan3D-2 && pip install -e .",
    )
    .env(
        {
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            "HF_HOME": f"{CACHE_DIR}/hf",
            "PYTHONPATH": "/opt/Hunyuan3D-2",
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
    timeout=900,
    scaledown_window=180,
    secrets=[AUTH_TOKEN_SECRET],
    max_containers=2,
)
class Hunyuan3DService:
    @modal.enter()
    def load(self):
        import torch
        from hy3dgen.shapegen import (
            Hunyuan3DDiTFlowMatchingPipeline,
            FloaterRemover,
            DegenerateFaceRemover,
            FaceReducer,
        )

        self.torch = torch
        Path(CACHE_DIR).mkdir(parents=True, exist_ok=True)
        self.pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            HF_REPO,
            cache_dir=f"{CACHE_DIR}/hf",
        )
        self.pipe.to("cuda")
        self.cleanup = [
            FloaterRemover(),
            DegenerateFaceRemover(),
            FaceReducer(),
        ]
        cache_volume.commit()

    @modal.fastapi_endpoint(method="POST", docs=True)
    async def generate(self, request: Request):
        return await self._handle(request)

    async def _handle(self, request):
        from fastapi import HTTPException, Response

        expected = os.environ.get("MODAL_AUTH_TOKEN", "").strip()
        if expected:
            auth = request.headers.get("authorization", "")
            if auth != f"Bearer {expected}":
                raise HTTPException(status_code=401, detail="unauthorized")

        form = await request.form()
        upload = form.get("image")
        if upload is None:
            raise HTTPException(status_code=400, detail="missing `image` field")

        raw = await upload.read()
        from PIL import Image as PILImage
        from rembg import remove
        import trimesh

        img = PILImage.open(io.BytesIO(raw)).convert("RGBA")
        img = remove(img)  # background removal helps Hunyuan3D-2 a lot

        with self.torch.inference_mode():
            mesh = self.pipe(image=img)[0]

        for step in self.cleanup:
            try:
                mesh = step(mesh)
            except Exception as e:
                print(f"[cleanup] {type(step).__name__} skipped: {e}")

        if not isinstance(mesh, trimesh.Trimesh):
            mesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces)

        out = io.BytesIO()
        mesh.export(out, file_type="glb")
        out.seek(0)

        return Response(
            content=out.getvalue(),
            media_type="model/gltf-binary",
            headers={"Content-Disposition": 'attachment; filename="mesh.glb"'},
        )

    @modal.fastapi_endpoint(method="POST", docs=True)
    async def flatten(self, request: Request):
        """Cut mesh along seams and flatten to 2D DXF patterns."""
        from fastapi import HTTPException, Response
        import json
        import trimesh
        import numpy as np
        from io import StringIO
        
        expected = os.environ.get("MODAL_AUTH_TOKEN", "").strip()
        if expected:
            auth = request.headers.get("authorization", "")
            if auth != f"Bearer {expected}":
                raise HTTPException(status_code=401, detail="unauthorized")
        
        body = await request.json()
        glb_url = body.get("glbUrl")
        seams = body.get("seams", [])
        
        if not glb_url:
            raise HTTPException(status_code=400, detail="missing glbUrl")
        
        # For now, return a placeholder response
        # Full implementation would:
        # 1. Download GLB from URL
        # 2. Cut mesh along seam polylines (duplicate vertices at seams)
        # 3. Use scipy or igl for LSCM/ARAP flattening
        # 4. Generate DXF LWPOLYLINE entities for each piece
        
        pieces = [
            {
                "id": "piece-1",
                "dxf": "0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0.0\n20\n0.0\n10\n10.0\n20\n0.0\n10\n10.0\n20\n10.0\n10\n0.0\n20\n10.0\n0\nENDSEC\n0\nEOF\n"
            }
        ]
        
        return {"pieces": pieces}
