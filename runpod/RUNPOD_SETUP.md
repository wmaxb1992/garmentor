# RunPod Serverless Setup Guide

This guide explains how to deploy TripoSR or TRELLIS 2 on RunPod Serverless for ultra-fast 3D generation.

## Performance Comparison

| Model | Inference Time | Quality | VRAM | Cold Start | Cost/hr (RTX 4090) |
|-------|---------------|---------|------|------------|-------------------|
| **TripoSR** | 0.5-2s | Good | 4GB | 200ms | $0.77 |
| **TRELLIS 2** | 5-20s | Excellent (4K) | 6GB+ | 200ms | $0.77 |
| Hunyuan3D-2 (Modal) | 15-40s | Good | 8GB+ | 30-60s | Higher |

## Quick Start

### Option 1: TripoSR (Fastest - Recommended for Production)

1. **Build and Push Docker Image**
   ```bash
   cd runpod
   docker build -t your-dockerhub-username/garmentor-triposr:latest .
   docker push your-dockerhub-username/garmentor-triposr:latest
   ```

2. **Create RunPod Serverless Endpoint**
   - Go to https://www.runpod.io/console/serverless
   - Click "New Endpoint"
   - Configure:
     - **Name**: `garmentor-triposr`
     - **Docker Image**: `your-dockerhub-username/garmentor-triposr:latest`
     - **GPU Type**: RTX 4090 or A100
     - **Min Workers**: 0 (auto-scale to zero)
     - **Max Workers**: 5
     - **FlashBoot**: ✅ Enabled (for 200ms cold starts)
     - **Idle Timeout**: 5 seconds

3. **Get Your Endpoint URL**
   - After creation, copy the endpoint URL (e.g., `https://api.runpod.ai/v2/your-endpoint-id/runsync`)
   - Save this for your `.env.local` file

### Option 2: TRELLIS 2 (Best Quality)

1. **Modify Dockerfile**
   ```bash
   # Edit runpod/Dockerfile and uncomment TRELLIS 2 lines:
   # - Line 30-31: Install TRELLIS
   # - Line 35: Use trellis_handler.py
   # - Line 39: Pre-download TRELLIS models
   ```

2. **Build and Deploy**
   ```bash
   docker build -t your-dockerhub-username/garmentor-trellis:latest .
   docker push your-dockerhub-username/garmentor-trellis:latest
   ```

3. **Create Endpoint** (same as TripoSR but with TRELLIS image)

## Environment Variables

Add to your `.env.local`:

```bash
# RunPod Serverless Endpoint
RUNPOD_ENDPOINT_URL=https://api.runpod.ai/v2/your-endpoint-id/runsync
RUNPOD_API_KEY=your-runpod-api-key

# Optional: Keep Modal as fallback
MODAL_GENERATE_URL=https://...
MODAL_AUTH_TOKEN=...
```

## API Usage

### TripoSR Request
```bash
curl -X POST https://api.runpod.ai/v2/your-endpoint-id/runsync \
  -H "Authorization: Bearer YOUR_RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "image": "base64_encoded_image_data",
      "remove_background": true,
      "mc_resolution": 256
    }
  }'
```

### TRELLIS 2 Request
```bash
curl -X POST https://api.runpod.ai/v2/your-endpoint-id/runsync \
  -H "Authorization: Bearer YOUR_RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "image": "base64_encoded_image_data",
      "remove_background": true,
      "num_inference_steps": 50,
      "guidance_scale": 7.5,
      "texture_resolution": 2048
    }
  }'
```

### Response Format
```json
{
  "id": "request-id",
  "status": "COMPLETED",
  "output": {
    "glb": "base64_encoded_glb_data",
    "vertices_count": 12345,
    "faces_count": 23456,
    "model": "TripoSR"
  }
}
```

## Cost Optimization

### Auto-Scaling
- **Min Workers: 0** - Scale to zero when idle (no cost)
- **Max Workers: 5** - Handle traffic spikes
- **Idle Timeout: 5s** - Quick scale-down

### FlashBoot Benefits
- **200ms cold starts** vs 30-60s traditional
- Users don't notice cold starts
- Enables true pay-per-use model

### Estimated Costs (RTX 4090 @ $0.77/hr)

**TripoSR:**
- Per request: ~$0.0004 (1.5s total)
- 1000 requests/day: ~$0.40/day
- 30,000 requests/month: ~$12/month

**TRELLIS 2:**
- Per request: ~$0.002 (10s total)
- 1000 requests/day: ~$2/day
- 30,000 requests/month: ~$60/month

## Monitoring

### RunPod Dashboard
- View request logs
- Monitor GPU utilization
- Track costs in real-time
- Set spending limits

### Health Check
```bash
curl https://api.runpod.ai/v2/your-endpoint-id/health
```

## Troubleshooting

### Cold Start Too Slow
- ✅ Enable FlashBoot
- ✅ Pre-download models in Dockerfile
- ✅ Use smaller base image

### Out of Memory
- Increase GPU type (RTX 4090 → A100)
- Reduce `mc_resolution` (TripoSR)
- Reduce `texture_resolution` (TRELLIS 2)

### Model Not Loading
- Check Docker build logs
- Verify model downloads in Dockerfile
- Test locally: `docker run -it your-image python handler.py`

## Migration from Modal

1. Deploy RunPod endpoint
2. Update `.env.local` with RunPod URL
3. Test with a few requests
4. Monitor performance and costs
5. Gradually shift traffic
6. Keep Modal as fallback initially

## Advanced: Hybrid Setup

Use both RunPod and Modal for redundancy:

```typescript
// lib/generate3d.ts
const RUNPOD_URL = process.env.RUNPOD_ENDPOINT_URL;
const MODAL_URL = process.env.MODAL_GENERATE_URL;

async function generate3d(imageBytes) {
  try {
    // Try RunPod first (faster)
    return await generateWithRunPod(imageBytes);
  } catch (error) {
    console.warn('RunPod failed, falling back to Modal:', error);
    // Fallback to Modal
    return await generateWithModal(imageBytes);
  }
}
```

## Support

- RunPod Docs: https://docs.runpod.io/serverless/overview
- TripoSR: https://github.com/VAST-AI-Research/TripoSR
- TRELLIS 2: https://github.com/Microsoft/TRELLIS
- Discord: https://discord.gg/runpod
