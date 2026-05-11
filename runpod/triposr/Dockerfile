# TripoSR on RunPod Serverless — image → 3D garment mesh (GLB).
#
# Build:
#   cd runpod/triposr
#   docker build -t YOUR_DOCKERHUB/garmentor-3d:latest .

FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential python3.10 python3.10-venv python3-pip \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python

WORKDIR /workspace

RUN pip install --no-cache-dir \
    torch==2.4.0 torchvision==0.19.0 --index-url https://download.pytorch.org/whl/cu121

# TripoSR pinned to upstream main; deps from its setup.py.
RUN git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git /workspace/TripoSR \
    && pip install --no-cache-dir -r /workspace/TripoSR/requirements.txt \
    && pip install --no-cache-dir /workspace/TripoSR

RUN pip install --no-cache-dir \
    runpod==1.7.0 \
    "huggingface_hub[hf_transfer]" \
    rembg \
    onnxruntime

# Weights download on first request (~0.6 GB).
COPY handler.py /workspace/handler.py
CMD ["python", "-u", "/workspace/handler.py"]
