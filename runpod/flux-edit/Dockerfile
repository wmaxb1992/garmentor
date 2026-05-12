# Image-to-image garment edit on RunPod Serverless.
# Default model: stabilityai/sdxl-turbo (ungated). FLUX.1-schnell still
# supported via EDIT_MODEL_ID env var (requires HF_TOKEN since it's gated).
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

# Pre-download SDXL-Turbo fp16 weights at build time.
# Only grab .safetensors (fp16 variant), JSON configs, and tokenizer files —
# skip ONNX and full-precision .bin to keep the image under the GHA disk limit.
# If the download still fails (tight disk), the handler falls back to a runtime
# download on first request; FlashBoot then snapshots the result for fast restarts.
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download('stabilityai/sdxl-turbo', \
    allow_patterns=['*.safetensors','*.json','*.txt','tokenizer*','*.model'], \
    ignore_patterns=['*.onnx','*.onnx_data','*.bin','*.msgpack'])" \
    || echo 'WARN: weights not cached — will download on first request'

COPY handler.py /workspace/handler.py

CMD ["python", "-u", "/workspace/handler.py"]
