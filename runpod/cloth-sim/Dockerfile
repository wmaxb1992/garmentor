# NVIDIA Warp cloth simulator for Garmentor.
#
# Takes triangulated GCD panels + stitch constraints (from lib/stitch-graph.ts)
# and an optional avatar mesh, runs XPBD on GPU, returns a draped GLB + fit
# metrics. Hardware: any 24 GB+ NVIDIA GPU.

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3-pip git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python

WORKDIR /workspace

RUN pip install --no-cache-dir \
    warp-lang==1.5.0 \
    trimesh==4.5.0 \
    numpy==1.26.4 \
    scipy==1.13.1 \
    runpod==1.7.0 \
    pyglet \
    pillow

COPY handler.py /workspace/handler.py
CMD ["python", "-u", "/workspace/handler.py"]
