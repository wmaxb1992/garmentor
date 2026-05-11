# SPAR3D (Stable Point-Aware Reconstruction in 3D) on RunPod Serverless.
# Replaces the earlier TripoSR build. Better back-side fidelity, modest speed
# cost (~5-10s warm vs TripoSR's 1-3s).

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

WORKDIR /workspace

RUN pip install --no-cache-dir --upgrade "pip<24" setuptools wheel

RUN pip install --no-cache-dir \
    torch==2.4.0 torchvision==0.19.0 --index-url https://download.pytorch.org/whl/cu121

# Pull SPAR3D source from upstream + install its deps. The requirements.txt
# references a local sibling package (./texture_baker/), so we must run pip
# from inside the repo for relative paths to resolve. Use the modern resolver
# (legacy resolver rejects ./path requirements).
RUN git clone --depth 1 https://github.com/Stability-AI/stable-point-aware-3d.git /workspace/SPAR3D \
    && cd /workspace/SPAR3D \
    && pip install --no-cache-dir -r requirements.txt
ENV PYTHONPATH=/workspace/SPAR3D

RUN pip install --no-cache-dir \
    runpod==1.7.0 \
    "huggingface_hub[hf_transfer]" \
    rembg \
    onnxruntime \
    pillow \
    trimesh

# Weights download to /root/.cache/huggingface on first request (~3 GB).
# stabilityai/stable-point-aware-3d is ungated.
COPY handler.py /workspace/handler.py
CMD ["python", "-u", "/workspace/handler.py"]
