# RunPod Serverless Dockerfile for TripoSR and TRELLIS 2
# Optimized for fast cold starts with FlashBoot

FROM runpod/pytorch:2.1.0-py3.10-cuda12.1.0-devel-ubuntu22.04

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir \
    runpod==1.6.0 \
    torch==2.1.0 \
    torchvision==0.16.0 \
    trimesh==4.0.5 \
    pillow==10.1.0 \
    numpy==1.24.3 \
    rembg==2.0.50 \
    onnxruntime-gpu==1.16.3 \
    xformers==0.0.22

# Install TripoSR
RUN pip install --no-cache-dir \
    git+https://github.com/VAST-AI-Research/TripoSR.git

# Install TRELLIS 2 (if using TRELLIS handler)
# Uncomment the following lines if you want to use TRELLIS 2
# RUN pip install --no-cache-dir \
#     git+https://github.com/Microsoft/TRELLIS.git

# Copy handler files
COPY triposr_handler.py /app/handler.py
# COPY trellis_handler.py /app/handler.py  # Use this instead for TRELLIS 2

# Pre-download models to reduce cold start time
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('stabilityai/TripoSR', local_dir='/app/models/triposr')"
# RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('JeffreyXiang/TRELLIS-image-large', local_dir='/app/models/trellis')"  # For TRELLIS 2

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/app/models
ENV TORCH_HOME=/app/models

# RunPod handler
CMD ["python", "-u", "/app/handler.py"]
