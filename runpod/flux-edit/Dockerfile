# Image-to-image garment edit on RunPod Serverless.
# Default model: stabilityai/sdxl-turbo (ungated). FLUX.1-schnell still
# supported via EDIT_MODEL_ID env var (requires HF_TOKEN since it's gated).
#
# IMPORTANT: Build LOCALLY — the image is ~10 GB which exceeds GitHub
# Actions free-runner disk limits. Run from your dev machine:
#
#   cd runpod/flux-edit
#   docker build -t ghcr.io/wmaxb1992/garmentor-flux-edit:latest .
#   docker push ghcr.io/wmaxb1992/garmentor-flux-edit:latest

FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-venv python3-pip git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python

WORKDIR /workspace

RUN pip install --no-cache-dir \
    torch==2.4.0 --index-url https://download.pytorch.org/whl/cu121 \
 && pip install --no-cache-dir \
    diffusers==0.31.0 \
    transformers==4.45.2 \
    accelerate==0.34.2 \
    sentencepiece \
    protobuf \
    safetensors \
    runpod==1.7.0 \
    "huggingface_hub[hf_transfer]" \
    pillow \
 && rm -rf /root/.cache/pip /tmp/*

# Bake SDXL-Turbo fp16 weights into the image — RunPod workers cannot
# reliably reach huggingface.co at runtime.
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download( \
    'stabilityai/sdxl-turbo', \
    local_dir='/workspace/models/sdxl-turbo', \
    allow_patterns=['*.json', '*.txt', '*.safetensors', '*.fp16.*'], \
    ignore_patterns=['*.bin', '*.ckpt', '*.msgpack', 'sdxl-turbo/'], \
)" && rm -rf /root/.cache/huggingface/hub

COPY handler.py /workspace/handler.py

CMD ["python", "-u", "/workspace/handler.py"]
