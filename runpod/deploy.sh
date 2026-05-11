#!/bin/bash
# RunPod Deployment Script with FlashBoot
# This script builds and deploys TripoSR to RunPod Serverless

set -e

echo "🚀 RunPod Deployment Script"
echo "============================"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker and try again."
    exit 1
fi

# Get Docker Hub username
read -p "Enter your Docker Hub username: " DOCKER_USERNAME
if [ -z "$DOCKER_USERNAME" ]; then
    echo "❌ Error: Docker Hub username is required"
    exit 1
fi

# Choose model
echo ""
echo "Select model to deploy:"
echo "1) TripoSR (fastest - <0.5s inference)"
echo "2) TRELLIS 2 (best quality - 4K textures)"
read -p "Enter choice (1 or 2): " MODEL_CHOICE

if [ "$MODEL_CHOICE" = "2" ]; then
    IMAGE_NAME="garmentor-trellis"
    echo "📦 Deploying TRELLIS 2..."
    
    # Modify Dockerfile for TRELLIS
    sed -i.bak 's/^COPY triposr_handler.py/# COPY triposr_handler.py/' Dockerfile
    sed -i.bak 's/^# COPY trellis_handler.py/COPY trellis_handler.py/' Dockerfile
    sed -i.bak 's/^# RUN pip install --no-cache-dir \\$/RUN pip install --no-cache-dir \\/' Dockerfile
    sed -i.bak 's/^#     git+https:\/\/github.com\/Microsoft\/TRELLIS.git/    git+https:\/\/github.com\/Microsoft\/TRELLIS.git/' Dockerfile
    sed -i.bak 's/^RUN python -c "from huggingface_hub/# RUN python -c "from huggingface_hub/' Dockerfile
    sed -i.bak 's/^# RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('\''JeffreyXiang/RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('\''JeffreyXiang/' Dockerfile
else
    IMAGE_NAME="garmentor-triposr"
    echo "📦 Deploying TripoSR..."
fi

FULL_IMAGE_NAME="$DOCKER_USERNAME/$IMAGE_NAME:latest"

echo ""
echo "Building Docker image: $FULL_IMAGE_NAME"
echo "This may take 10-15 minutes on first build..."
echo ""

# Build Docker image
docker build -t "$FULL_IMAGE_NAME" .

# Restore Dockerfile if modified
if [ -f "Dockerfile.bak" ]; then
    mv Dockerfile.bak Dockerfile
fi

echo ""
echo "✅ Docker image built successfully!"
echo ""

# Push to Docker Hub
read -p "Push to Docker Hub? (y/n): " PUSH_CONFIRM
if [ "$PUSH_CONFIRM" = "y" ] || [ "$PUSH_CONFIRM" = "Y" ]; then
    echo "Pushing to Docker Hub..."
    docker push "$FULL_IMAGE_NAME"
    echo "✅ Image pushed successfully!"
else
    echo "⏭️  Skipping push to Docker Hub"
fi

echo ""
echo "🎉 Deployment preparation complete!"
echo ""
echo "Next steps:"
echo "1. Go to https://www.runpod.io/console/serverless"
echo "2. Click 'New Endpoint'"
echo "3. Configure:"
echo "   - Name: $IMAGE_NAME"
echo "   - Docker Image: $FULL_IMAGE_NAME"
echo "   - GPU Type: RTX 4090 or A100"
echo "   - Min Workers: 0"
echo "   - Max Workers: 5"
echo "   - ⚡ FlashBoot: ENABLED (for 200ms cold starts)"
echo "   - Idle Timeout: 5 seconds"
echo "4. Copy the endpoint URL"
echo "5. Add to .env.local:"
echo "   RUNPOD_ENDPOINT_URL=https://api.runpod.ai/v2/your-endpoint-id/runsync"
echo "   RUNPOD_API_KEY=your-api-key"
echo ""
echo "📖 Full documentation: runpod/RUNPOD_SETUP.md"
