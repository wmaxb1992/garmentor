# Garmentor — Specification, Rules & Checklist

Single source of truth for the project. Read top-to-bottom and execute Phases 1 → 7 in order. Boxes track what's in `main` right now.

---

## 0. What Garmentor is

A web app that turns a photo of a garment into a **production-ready sewing pattern** (cuttable DXF), validated by **3D cloth simulation on an avatar**. All AI inference is self-hosted on **RunPod**; the Next.js web tier runs on **Cloudflare** via `@opennextjs/cloudflare`.

Pipeline at a glance:

```
photo ──► [GarmentGPT]    ──►  2D panels (GCD JSON)  ──►  DXF export
       └► [TripoSR]       ──►  3D mesh preview (GLB)
       └► [FLUX schnell]  ──►  edited mockup (image, optional)
                              ▼
                         [Cloth-Sim (NVIDIA Warp)] ──► draped GLB + fit metrics
                              ▼
                         [Critic loop]            ──► auto-grade pattern until fit converges
                              ▼
                         [Manufacturability gates] ──► block export if uncuttable / unsewable
```

---

## 1. Hard rules (immutable — agent must obey without explicit override)

1. **No external paid AI APIs.** Every model call goes to a RunPod endpoint owned by the user. No Anthropic, OpenAI, Modal, HuggingFace inference API, etc. HuggingFace as a *weight host* at build time is fine.
2. **Bun only.** `bun add` / `bun remove` / `bun run`. Never npm / yarn / pnpm. Never hand-edit `package.json` `dependencies`.
3. **No new heavy deps.** No shadcn, Radix, MUI, Chakra, styled-components, Redux, Zustand, Tanstack Query, Prisma, NextAuth. Plain Tailwind + React state + AI SDK v6 is enough.
4. **Web tier on Cloudflare.** `open-next.config.ts` is the deploy. Never propose Vercel / a Pod-hosted web tier.
5. **No `modal deploy` / `runpod deploy` / `vercel deploy` / `bun publish` / any push that bills the user without explicit per-action permission.** Endpoint *creation* with `Min Workers: 0` is allowed because $0 standing cost; **deletion of user-deployed resources** is not allowed without confirmation.
6. **Stay in phase.** Don't start Phase N+1 work while Phase N is unfinished unless the user asks.
7. **Don't change the architecture** without explicit user approval (e.g. don't swap RunPod for AWS, don't replace GarmentGPT with a different pattern model, don't propose alternative export formats).
8. **No `any` / `@ts-ignore` to make TS happy.** Fix types properly.
9. **No file moves or renames** of existing files unless the user asks.
10. **No `src/` directory.** Flat layout: `app/`, `components/`, `lib/`, `runpod/`, `scripts/`.
11. **Env vars** live in `.env.example` (committed) and `.env.local` (gitignored). Add new vars to `.env.example` whenever code reads them.
12. **Verify SDK signatures from disk** before calling anything from `ai`, `@ai-sdk/*`, `@react-three/drei`, `next`. The installed versions are newer than training data.
13. **Anti-patterns to never repeat** (each cost real debugging time this project):
    - Hardcoding a retired model id (`claude-sonnet-4-5`) — always read from env with a current default
    - Baking model weights into Docker images — exhausts GH Actions runner disk; weights download at first run
    - Passing `tools:` to a vLLM endpoint without `--enable-auto-tool-choice` — request hangs then 524
    - Relying on `streamText` to surface errors when tools are involved — add explicit `onError` + `onFinish` logging
    - Inlining API keys in shell commands — the harness blocks them; use env vars
    - Reading `message.content` instead of iterating `message.parts` (AI SDK v6 contract)
    - `next dev --turbopack` — Next 16 has turbopack default; the flag is gone
    - Calling `convertToModelMessages` without `await` — it returns a Promise

---

## 2. Architecture in one map

```
┌──────────────────────── Cloudflare ────────────────────────┐
│  Next.js 16 (App Router, React 19, Tailwind v4)             │
│  ├─ app/page.tsx           PasswordGate → AppShell           │
│  ├─ components/app-shell   Workspace ┃ MockupPanel ┃ BoM ┃ Chat
│  ├─ components/workspace   tabs: Pattern · Fit · Seams · Sketch
│  ├─ /api/chat              streamText + 5 tools              │
│  │     ├─ generate_pattern       → GarmentGPT  (RunPod)      │
│  │     ├─ generate_3d_model      → TripoSR     (RunPod)      │
│  │     ├─ edit_garment_image     → FLUX schnell (RunPod)     │
│  │     ├─ drape_pattern          → Warp cloth sim (RunPod)   │
│  │     └─ refine_pattern         → Phase 5 critic loop       │
│  └─ /api/generate-3d       legacy direct-3D endpoint         │
└────────────────────────────┬────────────────────────────────┘
                             │  (Bearer RUNPOD_API_KEY)
                             ▼
┌──────────────────────── RunPod ─────────────────────────────┐
│  garmentor-chat-vlm   Qwen2.5-VL-7B  (Serverless vLLM)       │
│  garmentor-pattern    GarmentGPT     (Serverless)            │
│  garmentor-3d         TripoSR        (Serverless)            │
│  garmentor-flux-edit  FLUX.1-schnell (Serverless)            │
│  garmentor-cloth-sim  NVIDIA Warp    (Serverless)            │
└─────────────────────────────────────────────────────────────┘
```

Worker quota note: RunPod default quota is **10 max workers across all endpoints**. Current allocation:

| Endpoint | workersMax |
|---|---|
| chat-vlm (new, tool-calling) | 1 |
| pattern | 2 |
| flux-edit | 1 |
| 3d | 2 |
| cloth-sim | 2 |
| chat-vlm (old, broken Quick Deploy — to be deleted) | 3 |

---

## 3. How a request flows

1. User loads `localhost:3000` (or production Cloudflare URL).
2. `PasswordGate` checks localStorage for the literal password `sassy`. If absent, shows the gate. Cached forever once entered.
3. `WorkspaceProvider` rehydrates `state.models`, `state.activeModelId`, and `state.viewer` from a per-project localStorage entry (auto-saved 250 ms after every state mutation).
4. User attaches a photo via the chat input → `ChatInput.onFiles` reads the bytes into a `File` and stores the data URL in `state.pendingImageUrl` + `state.pendingImageData`.
5. User sends a message → AI SDK v6 client (`useChat`) POSTs to `/api/chat` with the message history including the file part as a base64 data URL.
6. `/api/chat`:
   - Extracts the latest image into `latestImage`.
   - Builds an OpenAI-compatible provider against `RUNPOD_CHAT_BASE_URL` (Qwen2.5-VL on vLLM with hermes tool parser).
   - Streams a tool-call-capable response. The system prompt instructs Qwen to call `generate_pattern` + `generate_3d_model` in parallel after a photo is attached.
7. Each tool's `execute` reads bytes from the data URL (or a previously generated `/generated/*` URL), POSTs to the right RunPod endpoint, saves the artifact under `public/generated/{nanoId}.{ext}`, and returns metadata (`id`, urls, byte sizes).
8. The streaming response emits `tool-{name}` parts that the chat UI renders. `PatternToolPart` calls `addModel` + fetches the saved GCD JSON + calls `attachPattern`. `DrapeToolPart` calls `attachDrape`.
9. The `Workspace` component listens to `activeModel` and renders the matching tab (`Pattern` / `Fit` / `Seams` / `Sketch`). Tabs gate themselves on whether the model has `gcd` / `drapedGlbUrl` / `glbUrl`.
10. User exports DXF (Pattern tab → "Export DXF") → `lib/gcd-to-dxf.ts` flattens cubic Béziers and arcs to polylines, scales source-cm into the chosen output unit (mm / cm / in), emits one `LWPOLYLINE` per panel. (Phase 6 will gate this with manufacturability checks.)

---

## 4. File map

| Path | Purpose |
|---|---|
| `app/api/chat/route.ts` | Tool-calling orchestrator. Reads env vars per provider. |
| `app/api/generate-3d/route.ts` | Legacy direct 3D endpoint, bypasses chat. |
| `app/page.tsx` | Renders `<AppShell />` |
| `components/app-shell.tsx` | Top-level layout: `PasswordGate` → `WorkspaceProvider` → 3 panes |
| `components/workspace.tsx` | Tabs + active-model selector + ProjectControls header |
| `components/pattern-viewer.tsx` | SVG renderer for GCD panels + spec editor + DXF export button |
| `components/fit-viewer.tsx` | R3F renderer for the draped GLB + fit metrics bar |
| `components/seam-editor.tsx` | 3D viewer + manual seam drawing on the GLB |
| `components/flat-sketch.tsx` | Mesh-derived front/back silhouette with seam overlay |
| `components/mockup-panel.tsx` | Top-right pane: shows the active model's source image |
| `components/bom-panel.tsx` | Bottom-right pane: list of panels with W × H (cm) |
| `components/chat.tsx` | useChat UI + per-tool result renderers |
| `components/chat-input.tsx` | Text + image attachment input |
| `components/password-gate.tsx` | Pre-app password screen |
| `components/avatar-model.tsx` | SMPL-X-style translucent body for the SeamEditor |
| `components/project-controls.tsx` | New / Save / Save As / Load / Rename project dialogs |
| `components/seam-scene.tsx` | R3F mesh viewer with vertex-snap click handler |
| `lib/garment-gpt.ts` | Pattern endpoint client + `rescalePatternByReference` |
| `lib/generate3d.ts` | TripoSR endpoint client |
| `lib/edit-image.ts` | FLUX-edit endpoint client |
| `lib/cloth-sim.ts` | Warp cloth-sim endpoint client |
| `lib/stitch-graph.ts` | Ear-clip triangulation + GCD-stitch resampling |
| `lib/gcd-to-dxf.ts` | GCD JSON → DXF text (LWPOLYLINE per panel, unit conversion) |
| `lib/workspace-store.tsx` | React context: models, active id, viewer, project persistence |
| `lib/flat-sketch.ts` | Front/back silhouette SVG from mesh |
| `lib/mesh-measure.ts` | Bounding box + chest girth estimate from positions array |
| `lib/seam-graph.ts` | Dijkstra over mesh edges for shortest-path seam drawing |
| `lib/seam-detect.ts` | Auto-detect dark seam lines from texture luminance |
| `lib/glb-mesh.ts` | Merge GLTF meshes + extract positions/indices/normals |
| `lib/fabrics.ts` | Fabric PBR presets used in SeamScene |
| `runpod/garment-gpt/` | GarmentGPT handler + Dockerfile + source mirror |
| `runpod/triposr/` | TripoSR handler + Dockerfile |
| `runpod/flux-edit/` | FLUX schnell handler + Dockerfile |
| `runpod/cloth-sim/` | NVIDIA Warp handler + Dockerfile |
| `runpod/chat-vlm/` | README only — Qwen served by RunPod's worker-v1-vllm image |
| `runpod/DEPLOY.md` | Step-by-step deploy guide for the user |
| `scripts/runpod-create-endpoints.ts` | Creates Templates + Endpoints via RunPod REST; writes `.env.local` |
| `.github/workflows/build-runpod.yml` | Matrix build of pattern + flux-edit + triposr + cloth-sim → GHCR |
| `.env.example` | All required env vars (RunPod URLs + API key + chat model id) |
| `AGENTS.md` | Rules for the AI coding assistant (separate audience from this file) |
| `CHECKLIST.md` | This file |

---

## 5. RunPod endpoints

All endpoints: `Min Workers 0`, `FlashBoot ✅`, `Idle Timeout 10s`. Cost = $0 when idle; pay per second of active GPU time.

| Endpoint | Image | GPU | What it does | Env var |
|---|---|---|---|---|
| `garmentor-chat-vlm` | `runpod/worker-v1-vllm:v2.18.1` | L40S / A100 / H100 | Qwen2.5-VL-7B via OpenAI-compatible API with hermes tool parser | `RUNPOD_CHAT_BASE_URL`, `CHAT_MODEL` |
| `garmentor-pattern` | `ghcr.io/<owner>/garmentor-pattern` | RTX 4090 / L40S / A100 | GarmentGPT (VLM + VQ-VAE) → GCD panels | `RUNPOD_PATTERN_ENDPOINT_URL` |
| `garmentor-3d` | `ghcr.io/<owner>/garmentor-3d` | RTX 4090 / L40S / A4000 | TripoSR → textured GLB | `RUNPOD_GENERATE_ENDPOINT_URL` |
| `garmentor-flux-edit` | `ghcr.io/<owner>/garmentor-flux-edit` | RTX 4090 / L40S | FLUX.1-schnell image-to-image | `RUNPOD_EDIT_ENDPOINT_URL` |
| `garmentor-cloth-sim` | `ghcr.io/<owner>/garmentor-cloth-sim` | RTX 4090 / L40S | NVIDIA Warp XPBD garment drape | `RUNPOD_CLOTH_SIM_ENDPOINT_URL` |

All five share `RUNPOD_API_KEY` as the bearer token.

**Deploy order**:

1. `git push` → GH Actions builds the four custom images to GHCR (~15 min).
2. Make sure both GHCR packages are public (auto if the repo is public).
3. Deploy `chat-vlm` once via the RunPod UI (Serverless vLLM Quick Deploy was insufficient → use my recreated endpoint via `scripts/runpod-create-endpoints.ts`).
4. `export RUNPOD_API_KEY=...` and `bun scripts/runpod-create-endpoints.ts` → creates the four serverless endpoints and writes URLs into `.env.local`.
5. `bun run dev` and verify each endpoint warms up (first request to each = 5–15 min cold start).

---

## 6. Phased checklist

### Phase 1 — Reference-dimension rescale ✅ DONE

Single-measurement calibration so panel sizes are absolute, not arbitrary.

- [x] `lib/garment-gpt.ts:rescalePatternByReference` — `{ kind: back_length | chest_girth | total_width, valueCm }` rescales every vertex + translation
- [x] `generate_pattern` tool accepts `referenceMeasurement` arg
- [x] System prompt asks user once for a reference dimension

### Phase 2 — TripoSR mesh + parallel generation ⏳

Photo → GLB in parallel with photo → pattern. Both attach to the same `Model`.

- [x] `runpod/triposr/handler.py` + `Dockerfile`
- [x] GH Actions matrix builds `ghcr.io/<owner>/garmentor-3d`
- [x] `scripts/runpod-create-endpoints.ts` provisions `garmentor-3d`
- [x] System prompt fires `generate_pattern` + `generate_3d_model` in parallel
- [ ] GHCR build green (run `25653500499`)
- [ ] Deploy script run
- [ ] Avatar overlay confirmed in SeamEditor with TripoSR garment

### Phase 3 — Panel spec editor ✅ DONE

Per-panel W × H inputs in the right rail of the Pattern tab.

- [x] `components/pattern-viewer.tsx` right-side panel list with selectable rows + W × H number inputs
- [x] Click-to-select highlights the panel on the SVG canvas
- [x] Uniform rescale about the panel's centroid via `attachPattern`
- [ ] **Future**: per-garment-category grade rules (CB / CF / HPS / hem / armhole grade points instead of uniform)

### Phase 4 — Cloth sim with NVIDIA Warp ⏳

Stitch the 2D panels, drape under gravity (optional avatar mesh collision), surface fit metrics.

- [x] `lib/stitch-graph.ts` — ear-clipping triangulation + stitch-edge resampling
- [x] `runpod/cloth-sim/handler.py` — Warp XPBD with tri / edge / stitch / contact constraints
- [x] `runpod/cloth-sim/Dockerfile` — `warp-lang==1.5.0` on CUDA 12.4
- [x] GH Actions matrix builds `ghcr.io/<owner>/garmentor-cloth-sim`
- [x] `scripts/runpod-create-endpoints.ts` provisions `garmentor-cloth-sim`
- [x] `lib/cloth-sim.ts` client; saves draped GLB under `public/generated/{id}.draped.glb`
- [x] `/api/chat` `drape_pattern` tool
- [x] `components/fit-viewer.tsx` + Fit tab + verdict pill (pulling / excess / good fit)
- [x] `chat.tsx` `DrapeToolPart` calls `attachDrape`
- [ ] GHCR build green (run `25653859417`)
- [ ] Deploy script run
- [ ] First successful drape in browser

### Phase 5 — Critic loop (agentic refinement) ✅ DONE

Self-correcting pipeline: drape → critic → grade-delta → re-drape, up to 3 cycles. Native (no BeeAI dep yet). Critic is a JSON-only generateObject call against the same chat-vlm endpoint.

- [x] `lib/agents/critic.ts` — `generateObject` with a Zod schema; input = panel dim summary + drape metrics + optional reference measurement; output = `{ should_modify, reason, deltas[] }`
- [x] `lib/agents/modifier.ts` — applies deltas via length/chest/sleeve/width heuristic grade-point translation (real grade points are future work)
- [x] `lib/workflow/refine-pattern.ts` — drape→critic→modify loop, early-exit on convergence
- [x] `/api/chat` `refine_pattern` tool: loads prior GCD by id, runs the workflow, persists the refined GCD under a new id, returns cycles + final metrics
- [x] `components/chat.tsx` `RefineToolPart` renders the per-cycle log (max stretch / max compression / reason) and "Set as active" the refined pattern
- [x] System prompt advertises the tool; assistant should prefer it after the user supplies a reference measurement

### Phase 6 — Manufacturability gates ✅ DONE

Three synchronous gates that block DXF export if the pattern is unfit for cutting / sewing / costing. All client-side; runs on every render in `useGates(pattern)`.

- [x] **Cuttability** (`lib/gates/cuttability.ts`): polygon-SAT overlap on a tallest-first row-pack at the configured fabric width, min turn radius ≥ 2 mm, simple-polygon check, panel-width-vs-fabric-width.
- [x] **Yardage** (`lib/gates/yardage.ts`): row-pack length + efficiency %, optional `budgetYards` + `costPerYardUsd`.
- [x] **Stitch** (`lib/gates/stitch.ts`): every stitched edge pair within ±5 % arc-length parity.
- [x] `lib/gates/run-all.ts` aggregates `{ pass, cuttability, yardage, stitch }`.
- [x] `components/gates-panel.tsx` — banner above the SVG canvas: green ✓ / red ✗ pill per gate with hover detail.
- [x] `Export DXF` button disabled while gates fail; tooltip points at the gates panel.

### Phase 7 — Multi-view consensus ✅ DONE

When the user attaches 2-3 photos (front / back / side), one Pattern Agent runs per view in parallel; a reconciler merges them.

- [x] `components/chat-input.tsx` accepts up to 3 image files with thumbnail row; `multiple` on the file input
- [x] `/api/chat` `generate_pattern_multiview` tool fans out `generatePatternFromBytes` across every attached image via `Promise.all`, then reconciles
- [x] `lib/agents/reconciler.ts` — median-W×H consensus per shared panel name, union of stitches, preserves unique panels from each view
- [x] Reconciled GCD is what gets passed to cloth-sim / DXF / refine_pattern
- [x] `description` carries "merged from N views" so the chat result surfaces the view count

---

### Phase 8 — Continuous improvements (in-flight)

Smaller-scope improvements that get layered on top of Phases 1-7. Not gated; merged piecewise.

- [x] **Unit tests** under `tests/unit/`: gates, modifier, reconciler, stitch-graph. Fixture is the real GarmentGPT `my_garment.json` output. Runs via `bun test tests/unit/`.
- [x] **Yardage auto-rotation**: rotate panels 90° in the row-pack when it makes them narrower than fabric and improves density.
- [x] **Actionable gate deltas**: `runAllGates` now returns `proposedDeltas` mapping stitch-mismatches → length corrections and oversized panels → width corrections. `applyGateFixes(pattern, gates)` returns a patched GCD.
- [x] **Apply suggested fixes button**: the gates banner exposes an amber "Apply suggested fixes (N)" button that pushes the modifier output into the workspace store. Pairs with undo (cmd/ctrl-Z).
- [x] **Spec-edit undo**: 25-step history stack in `PatternViewer`. cmd/ctrl-Z rolls back any panel resize or "apply fixes" action.
- [x] **Spec-edit redo** (cmd/ctrl-shift-Z).
- [x] **Keyboard navigation**: ArrowUp / ArrowDown cycle the selected panel (when not typing in an input).
- [x] **Playwright smoke** for the Pattern tab — loads via PasswordGate, injects fixture via the React fiber walk, asserts panel list + gates banner + Export DXF render. 951ms run.
- [x] **`bun test` + `bun test:e2e` scripts** in package.json.
- [ ] **Mesh silhouette overlay** in Pattern tab — project the TripoSR GLB front-view silhouette behind the GCD panels at the same scale so the user can eyeball pattern-vs-mesh fit without leaving the tab.
- [ ] **Playwright smoke** that loads the app behind PasswordGate, injects a fixture model via the workspace context, and verifies all 4 tabs render.
- [ ] **DXF in-browser preview** before download — render the LWPOLYLINE entities client-side as a confirmation view.
- [ ] **`bun test:e2e`** script in package.json wiring the existing Playwright setup.
- [ ] **Critic-cycle live progress** — server-side `streamObject` so the chat UI tickers each cycle as it happens instead of dumping all 3 at the end.
- [ ] **Real grade rules per garment category** (jacket / shirt / pants) replacing the bbox heuristic in `modifier.ts`. Largest accuracy lever still open.
- [ ] **Warm-worker option** behind a UI toggle: prompt the user "keep chat worker warm? +$0.77/hr" before sending the first message; default off.
- [ ] **Project export/import** to a `.garmentor.json` file for sharing.

## 7. Open infra todos

- [ ] Delete the old broken Quick Deploy chat endpoint `xezftfvzsmw722` (user-only action; saves 3 worker slots)
- [ ] Phase 4 GHCR build finishes (run `25653859417`)
- [ ] Run `bun scripts/runpod-create-endpoints.ts` once builds green (writes 4 endpoint URLs to `.env.local`)
- [ ] Rotate the Anthropic + RunPod API keys that ended up in chat transcripts during this session
- [ ] First end-to-end browser test: attach jacket photo, ask for pattern + drape, see panels + Fit verdict
- [ ] After confirming the new chat-vlm works, delete the stale `MODAL_*` and `ANTHROPIC_*` lines from `.env.local` (currently commented out by the migration; can be removed)

---

## 8. Useful UI / chat behaviors (for the user)

- Password to enter: **`sassy`** (set via `localStorage["garmentor:auth"]`)
- Pattern tab: click a panel in the SVG **or** in the right rail to highlight; edit the W × H numbers and tab/Enter to apply a centroid-uniform rescale
- DXF export unit is configurable per export (mm default; cm or in available)
- Workspace → "Save As" persists everything (models + GCD + drape + viewer settings) under a named project in localStorage
- "Load" surfaces every saved project; "New" starts fresh; "Save" overwrites the current project
- Chat input accepts one image at a time today (Phase 7 will lift to 3)
- Cold-start the first call to each endpoint takes 5–15 min while RunPod pulls the image + downloads weights; subsequent calls within ~10 s are warm (~5–15 s)
