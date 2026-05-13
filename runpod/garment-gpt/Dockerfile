# GarmentGPT on RunPod Serverless.
#
# IMPORTANT: Build LOCALLY — the image is ~25 GB (includes baked-in model
# weights) which exceeds GitHub Actions free-runner disk limits.
#
#   cd runpod/garment-gpt
#   docker build -t ghcr.io/wmaxb1992/garmentor-pattern:latest .
#   docker push ghcr.io/wmaxb1992/garmentor-pattern:latest
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
    git build-essential software-properties-common curl \
    libgl1 libglib2.0-0 ca-certificates \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
       python3.11 python3.11-venv python3.11-dev python3.11-distutils \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11

WORKDIR /workspace

# torch 2.5.1 + cu121 — required by vllm 0.7.3.
RUN pip install --no-cache-dir \
    torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu121

# Pin transformers to 4.49.0 — the version the checkpoint was trained with.
# vLLM 0.7.3 is the matching version for that era; 0.10.x fails model
# inspection because the LLaVA config format changed after 4.49.
RUN pip install --no-cache-dir \
    vllm==0.7.3 \
    transformers==4.49.0 \
    peft==0.15.0 \
    runpod==1.7.0 \
    huggingface_hub[hf_transfer] \
    fire \
    pyyaml \
    pillow \
    "numpy<2" \
    tqdm \
    einops \
    vector-quantize-pytorch \
    matplotlib

# LLaMA-Factory is required for tokenizer/template helpers used by main.py.
# Pin to v0.9.2 (March 2025) — matches the transformers 4.49 era when the
# GarmentGPT checkpoint was trained. HEAD breaks with older transformers.
RUN git clone --depth 1 --branch v0.9.2 https://github.com/hiyouga/LLaMA-Factory.git /workspace/LLaMA-Factory \
    && pip install --no-cache-dir -e /workspace/LLaMA-Factory

# Copy the Garment-GPT source into the image.
COPY garment-gpt-src /workspace/garment-gpt

# Bake GarmentGPT inference weights into the image — RunPod workers cannot
# reliably reach huggingface.co at runtime.  Skip DeepSpeed optimizer states,
# RNG states, and training artifacts (~50 GB of unnecessary data).
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download( \
    'ChimerAI/GarmentGPT', \
    local_dir='/workspace/checkpoints', \
    max_workers=8, \
    ignore_patterns=[ \
        '*/global_step*/*', \
        '*/rng_state_*.pth', \
        '*/scheduler.pt', \
        '*/trainer_state.json', \
        '*/training_args.bin', \
        '*/zero_to_fp32.py', \
        '*/latest', \
    ], \
)" && rm -rf /root/.cache/huggingface/hub

COPY handler.py /workspace/handler.py

CMD ["python", "-u", "/workspace/handler.py"]
