# Fix garmentor.ai Custom Domain

## Current Status

✅ **Working Deployment**: https://garmentor.max-4ff.workers.dev
- Returns HTTP 200
- Shows correct title: "Garmentor"
- All functionality working

⚠️ **garmentor.ai Domain Issue**: Currently points to an old deployment
- Shows title: "Garmentor-AI — Pattern Viewer" (old version)
- Needs to be updated to point to the new Workers deployment

## Solution: Update Custom Domain Routing

### Option 1: Via Cloudflare Dashboard (Recommended)

1. **Go to Cloudflare Dashboard**: https://dash.cloudflare.com
2. **Navigate to Workers & Pages**
3. **Find the `garmentor` worker** (not the Pages project)
4. **Click on Settings → Domains & Routes**
5. **Add Custom Domain**:
   - Click "Add Custom Domain"
   - Enter: `garmentor.ai`
   - Click "Add Domain"
6. **Add www subdomain** (optional):
   - Repeat for `www.garmentor.ai`

### Option 2: Via Wrangler CLI

```bash
# Add custom domain to the worker
wrangler deploy --name garmentor --route garmentor.ai/*
wrangler deploy --name garmentor --route www.garmentor.ai/*
```

### Option 3: Remove from Pages, Add to Workers

If garmentor.ai is currently attached to the Pages project:

1. **Remove from Pages**:
   - Go to Pages → garmentor project
   - Settings → Custom Domains
   - Remove `garmentor.ai`

2. **Add to Workers**:
   - Follow Option 1 above

## Verification

After updating the domain, verify it works:

```bash
# Should return 200 and show "Garmentor" title
curl -s https://garmentor.ai | grep -o "<title>.*</title>"

# Should return 200
curl -s -o /dev/null -w "%{http_code}" https://garmentor.ai
```

## Why This Happened

- The deployment created TWO separate projects:
  1. **Pages project** (`garmentor.pages.dev`) - Has the custom domain but deployments fail
  2. **Workers project** (`garmentor.max-4ff.workers.dev`) - Working correctly but no custom domain

- The fix is to move the custom domain from the failing Pages project to the working Workers deployment

## DNS Propagation

After making the change, DNS may take a few minutes to propagate. The domain should work within 5-10 minutes.
