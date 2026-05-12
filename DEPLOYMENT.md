# Deployment Guide for garmentor.ai

This guide covers deploying Garmentor to Cloudflare Pages.

## Prerequisites

1. **Cloudflare Account**: Sign up at https://dash.cloudflare.com
2. **Wrangler CLI**: Already installed (v4.75.0)
3. **Modal Endpoints**: Ensure Modal services are deployed and URLs are available

## Environment Variables

The following environment variables must be set in Cloudflare Pages dashboard:

### Required Secrets (Set via Cloudflare Dashboard)

1. **ANTHROPIC_API_KEY** - Your Anthropic API key for Claude
   - Get from: https://console.anthropic.com/settings/keys
   
2. **MODAL_GENERATE_URL** - Modal endpoint for 3D generation
   - Example: `https://max-51632--garmentor-mesh-hunyuan3dservice-generate.modal.run`
   - Get from: `modal deploy modal/app.py` output
   
3. **MODAL_EDIT_URL** - Modal endpoint for image editing
   - Example: `https://max-51632--garmentor-edit-qwenimageeditservice-edit.modal.run`
   - Get from: `modal deploy modal/edit.py` output
   
4. **MODAL_AUTH_TOKEN** - Shared secret for Modal endpoints
   - Generate a random string (e.g., using `openssl rand -hex 32`)
   - Must match the secret set in Modal

### Optional Variables

- **ANTHROPIC_MODEL** - Defaults to `claude-sonnet-4-5` (already set in wrangler.jsonc)

## Deployment Steps

### Option 1: Deploy via Wrangler CLI (Recommended)

1. **Authenticate with Cloudflare**:
   ```bash
   wrangler login
   ```

2. **Set Environment Secrets**:
   ```bash
   # Set secrets via wrangler (more secure than vars)
   wrangler pages secret put ANTHROPIC_API_KEY
   wrangler pages secret put MODAL_GENERATE_URL
   wrangler pages secret put MODAL_EDIT_URL
   wrangler pages secret put MODAL_AUTH_TOKEN
   ```

3. **Deploy**:
   ```bash
   bun run deploy
   ```
   
   This will:
   - Build the Next.js app
   - Bundle for Cloudflare Workers
   - Deploy to Cloudflare Pages

### Option 2: Deploy via Cloudflare Dashboard

1. **Build locally**:
   ```bash
   bun run build:cloudflare
   ```

2. **Go to Cloudflare Dashboard**:
   - Navigate to Pages
   - Create a new project
   - Upload the `.open-next/assets` directory

3. **Configure Environment Variables**:
   - Go to Settings → Environment Variables
   - Add all required secrets listed above

### Option 3: Connect GitHub Repository

1. **Push to GitHub** (if not already done):
   ```bash
   git push origin main
   ```

2. **Connect in Cloudflare Dashboard**:
   - Pages → Create a project → Connect to Git
   - Select your repository
   - Configure build settings:
     - **Build command**: `bun run build:cloudflare`
     - **Build output directory**: `.open-next/assets`
     - **Root directory**: `/`

3. **Add Environment Variables** in the dashboard

## Custom Domain Setup

1. **Add Custom Domain**:
   - In Cloudflare Pages project settings
   - Go to Custom Domains
   - Add `garmentor.ai` and `www.garmentor.ai`

2. **DNS Configuration**:
   - Cloudflare will automatically configure DNS if domain is on Cloudflare
   - Otherwise, add CNAME records pointing to your Pages URL

## Troubleshooting

### Build Fails with Infinite Loop

**Fixed**: The build script now uses `next build` directly to prevent recursion.
- Use `bun run build:cloudflare` for Cloudflare builds
- Use `bun run build` for standard Next.js builds

### Environment Variables Not Working

- Ensure secrets are set via `wrangler pages secret put` or Cloudflare dashboard
- Secrets are different from vars - use secrets for sensitive data
- Redeploy after adding new secrets

### 3D Generation Fails

- Verify `MODAL_GENERATE_URL` is correct and accessible
- Check `MODAL_AUTH_TOKEN` matches between Cloudflare and Modal
- Ensure Modal service is deployed and running

### Image Editing Fails

- Verify `MODAL_EDIT_URL` is correct and accessible
- Check Modal service logs for errors

## Post-Deployment Verification

1. **Test the Chat Interface**:
   - Visit https://garmentor.ai
   - Verify chat loads and responds

2. **Test Image Upload**:
   - Upload a garment image
   - Verify it processes correctly

3. **Test 3D Generation**:
   - Request 3D model generation
   - Verify GLB file is created and viewable

4. **Test Image Editing**:
   - Request an edit to a garment
   - Verify edited image is generated

## Monitoring

- **Cloudflare Analytics**: View traffic and performance metrics
- **Cloudflare Logs**: Check for errors in Functions logs
- **Modal Logs**: Monitor Modal endpoints for processing errors

## Updating the Deployment

```bash
# Make your changes, then:
bun run deploy
```

Or if using GitHub integration, simply push to main:
```bash
git push origin main
```

## Cost Considerations

- **Cloudflare Pages**: Free tier includes 500 builds/month, unlimited requests
- **Cloudflare Workers**: Free tier includes 100,000 requests/day
- **Modal**: Pay-per-use for GPU time (L40S)
- **Anthropic API**: Pay-per-token usage

## Support

For deployment issues:
1. Check Cloudflare Pages logs
2. Check Modal service status
3. Verify all environment variables are set correctly
4. Review this guide for common issues
