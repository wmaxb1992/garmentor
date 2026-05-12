# Deployment Checklist for garmentor.ai

## Pre-Deployment Checklist

- [x] **Build Configuration Fixed** - Infinite loop issue resolved
- [x] **Package.json Updated** - Separate build scripts for local and Cloudflare
- [x] **Next.js Config** - Standalone output mode enabled
- [x] **Wrangler Config** - Cloudflare Pages configuration ready
- [x] **Environment Variables** - `.env.example` documented
- [ ] **Modal Services Deployed** - Both `app.py` and `edit.py` must be running
- [ ] **Secrets Configured** - Set in Cloudflare dashboard or via wrangler

## Quick Deploy Commands

### 1. Build for Cloudflare
```bash
bun run build:cloudflare
```

### 2. Deploy to Cloudflare Pages
```bash
bun run deploy
```

Or deploy manually:
```bash
wrangler pages deploy .open-next/assets --project-name=garmentor
```

## Environment Variables to Set in Cloudflare

Before deploying, ensure these are set in Cloudflare Pages:

```bash
# Via Wrangler CLI (recommended):
wrangler pages secret put ANTHROPIC_API_KEY
wrangler pages secret put MODAL_GENERATE_URL
wrangler pages secret put MODAL_EDIT_URL
wrangler pages secret put MODAL_AUTH_TOKEN
```

Or via Cloudflare Dashboard:
1. Go to Pages → garmentor → Settings → Environment Variables
2. Add each secret for Production environment

## Verify Modal Endpoints

Before deploying, ensure Modal services are running:

```bash
# Deploy Modal services (if not already done)
modal deploy modal/app.py
modal deploy modal/edit.py
```

Copy the URLs from the output and set them as environment variables.

## Post-Deployment Tests

After deployment, verify:

1. **Site loads**: Visit https://garmentor.ai
2. **Chat works**: Send a message to the assistant
3. **Image upload**: Attach a garment photo
4. **3D generation**: Request 3D model generation
5. **Image editing**: Request design modifications
6. **Seam editor**: Draw seams on generated models

## Troubleshooting

### Build fails
- Check that `bun run build:cloudflare` completes successfully locally
- Review build logs in Cloudflare dashboard

### Runtime errors
- Check Cloudflare Functions logs
- Verify all environment variables are set
- Ensure Modal endpoints are accessible

### 3D generation fails
- Verify `MODAL_GENERATE_URL` is correct
- Check Modal service logs
- Ensure `MODAL_AUTH_TOKEN` matches

## Files Changed

The following files were modified to fix deployment issues:

1. **package.json** - Split build scripts
2. **next.config.ts** - Added standalone output mode
3. **wrangler.jsonc** - Added default vars
4. **.gitignore** - Added OpenNext build artifacts
5. **DEPLOYMENT.md** - Comprehensive deployment guide (new)
6. **DEPLOY_CHECKLIST.md** - This file (new)

## Key Fixes Applied

### ✅ Infinite Build Loop (FIXED)
**Problem**: `opennextjs-cloudflare build` was calling `bun run build`, which called `opennextjs-cloudflare build` again.

**Solution**: 
- Changed `build` script to `next build` (standard Next.js build)
- Created `build:cloudflare` script for Cloudflare-specific builds
- Updated `deploy` and `preview` scripts to use `build:cloudflare`

### ✅ Environment Variables
**Problem**: Secrets need to be configured in Cloudflare.

**Solution**:
- Documented all required environment variables
- Added instructions for setting secrets via wrangler or dashboard
- Set default `ANTHROPIC_MODEL` in wrangler.jsonc

### ✅ Build Output
**Problem**: Need proper configuration for Cloudflare Workers.

**Solution**:
- Set `output: "standalone"` in next.config.ts
- Configured `pages_build_output_dir` in wrangler.jsonc
- Added `.open-next/` to .gitignore

## Ready to Deploy? ✅

If all items in the Pre-Deployment Checklist are checked, you're ready to deploy!

```bash
bun run deploy
```

For detailed instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md)
