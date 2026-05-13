# TripoSR on RunPod Serverless — image → 3D garment mesh (GLB).
#
# IMPORTANT: Build LOCALLY — RunPod workers cannot reliably reach
# huggingface.co at runtime, so weights are baked into the image.
#
# Build:
#   cd runpod/triposr
#   docker build -t ghcr.io/wmaxb1992/garmentor-3d:latest .
#   docker push ghcr.io/wmaxb1992/garmentor-3d:latest

# torchmcubes (used by TripoSR) is a CUDA-C++ extension and needs nvcc +
# Python.h at build time, so we use the -devel base image, not -runtime.
FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential ninja-build \
    python3.10 python3.10-dev python3.10-venv python3-pip \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python

# torchmcubes needs both `ninja` (apt) and the `ninja` Python wheel.
RUN pip install --no-cache-dir ninja setuptools wheel

WORKDIR /workspace

RUN pip install --no-cache-dir \
    torch==2.4.0 torchvision==0.19.0 --index-url https://download.pytorch.org/whl/cu121

# TripoSR is a script-based project (no setup.py/pyproject.toml). Install
# its deps from requirements.txt, then put the repo on PYTHONPATH so the
# `tsr.system` / `tsr.utils` imports resolve at runtime.
# The new pip resolver hits an internal AssertionError on TripoSR's req set —
# fall back to the legacy resolver, which handles it cleanly.
RUN pip install --no-cache-dir --upgrade "pip<24" \
    && git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git /workspace/TripoSR \
    && pip install --no-cache-dir --use-deprecated=legacy-resolver \
       -r /workspace/TripoSR/requirements.txt
ENV PYTHONPATH=/workspace/TripoSR

RUN pip install --no-cache-dir \
    "numpy<2" \
    runpod==1.7.0 \
    "huggingface_hub[hf_transfer]<1.0" \
    rembg \
    onnxruntime

# Bake TripoSR weights into the image (~0.6 GB) — RunPod workers cannot
# reliably reach huggingface.co at runtime.
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download( \
    'stabilityai/TripoSR', \
    local_dir='/workspace/models/TripoSR', \
)" && rm -rf /root/.cache/huggingface/hub

# Pre-download rembg u2net model so it doesn't need network at runtime.
RUN python -c "\
from rembg import remove; \
from PIL import Image; \
img = Image.new('RGB', (64, 64), (128, 128, 128)); \
remove(img); \
print('rembg model cached')"

COPY handler.py /workspace/handler.py
CMD ["python", "-u", "/workspace/handler.py"]
