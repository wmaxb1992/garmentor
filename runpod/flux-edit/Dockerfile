# FLUX.1-schnell image-to-image edit on RunPod Serverless.
#
# Build:
#   cd runpod/flux-edit
#   docker build -t YOUR_DOCKERHUB/garmentor-flux-edit:latest .
#   docker push YOUR_DOCKERHUB/garmentor-flux-edit:latest

FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-venv python3-pip git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python

WORKDIR /workspace

RUN pip install --no-cache-dir \
    torch==2.4.0 --index-url https://download.pytorch.org/whl/cu121

RUN pip install --no-cache-dir \
    diffusers==0.31.0 \
    transformers==4.45.2 \
    accelerate==0.34.2 \
    sentencepiece \
    protobuf \
    safetensors \
    runpod==1.7.0 \
    "huggingface_hub[hf_transfer]" \
    pillow

# Weights are NOT baked in — diffusers downloads FLUX.1-schnell (~24 GB) into
# the HF cache on first request and reuses it for the worker's lifetime. Image
# stays small enough to build on GitHub Actions free runners.

COPY handler.py /workspace/handler.py

CMD ["python", "-u", "/workspace/handler.py"]
