# GarmentGPT on RunPod Serverless.
#
# Build:
#   cd runpod/garment-gpt
#   docker build -t YOUR_DOCKERHUB/garmentor-pattern:latest .
#   docker push YOUR_DOCKERHUB/garmentor-pattern:latest
#
# RunPod endpoint: set Docker image to the pushed tag, GPU type RTX 4090 / A100,
# Min Workers 0, FlashBoot ✅, Idle Timeout 5s.

FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DISABLE_VERSION_CHECK=1 \
    VLLM_ALLOW_LONG_MAX_MODEL_LEN=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential python3.10 python3.10-venv python3-pip \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python

WORKDIR /workspace

# Pinned to the versions in upstream Garment-GPT requirements.txt.
RUN pip install --no-cache-dir \
    torch==2.4.0 torchvision==0.19.0 --index-url https://download.pytorch.org/whl/cu121

RUN pip install --no-cache-dir \
    vllm==0.10.2 \
    transformers==4.56.2 \
    peft==0.15.0 \
    runpod==1.7.0 \
    huggingface_hub[hf_transfer] \
    fire \
    pyyaml \
    pillow \
    numpy

# LLaMA-Factory is required for tokenizer/template helpers used by main.py.
RUN git clone --depth 1 https://github.com/hiyouga/LLaMA-Factory.git /workspace/LLaMA-Factory \
    && pip install --no-cache-dir -e /workspace/LLaMA-Factory

# Copy the Garment-GPT source into the image.
COPY garment-gpt-src /workspace/garment-gpt

# Weights are NOT baked in — they download to /workspace/checkpoints on first
# request and cache to the worker's local disk (or to a RunPod Network Volume
# if one is mounted at /workspace/checkpoints). Image stays under ~5 GB so it
# fits comfortably on GitHub Actions free runners.

COPY handler.py /workspace/handler.py

CMD ["python", "-u", "/workspace/handler.py"]
