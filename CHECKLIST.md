# Garmentor — Hybrid Pipeline Checklist

End-to-end roadmap for the RunPod-only pipeline that combines GarmentGPT (pattern), TripoSR (preview mesh), NVIDIA Warp (cloth sim), and agentic refinement. Boxes track code (in `main`) and infra (RunPod endpoints).

---

## Phase 1 — Reference-dimension rescale (DONE)

Single-measurement calibration so panel sizes are absolute, not arbitrary.

- [x] `lib/garment-gpt.ts:rescalePatternByReference` — accepts `{ kind: back_length | chest_girth | total_width, valueCm }` and uniformly rescales every panel vertex + translation.
- [x] `generate_pattern` tool accepts `referenceMeasurement` arg.
- [x] System prompt instructs the assistant to ask once for a reference dimension.

## Phase 2 — TripoSR mesh + parallel generation

Photo → GLB in parallel with photo → pattern. Same workspace item gets both.

- [x] `runpod/triposr/handler.py` + `Dockerfile`.
- [x] `.github/workflows/build-runpod.yml` builds `ghcr.io/<owner>/garmentor-3d:latest`.
- [x] `scripts/runpod-create-endpoints.ts` provisions the `garmentor-3d` Serverless endpoint and writes `RUNPOD_GENERATE_ENDPOINT_URL` to `.env.local`.
- [x] System prompt fires `generate_pattern` + `generate_3d_model` in parallel.
- [ ] GHCR build green (run `25653500499`).
- [ ] Deploy script run.
- [ ] Avatar overlay confirmed in SeamEditor with TripoSR garment.

## Phase 3 — Panel spec editor (DONE)

Per-panel W × H inputs in the right rail of the Pattern tab.

- [x] `components/pattern-viewer.tsx`: side panel list with selectable rows and W × H number inputs.
- [x] Click-to-select highlights the panel on the SVG canvas.
- [x] Uniform rescale about the panel's centroid; updates the workspace store via `attachPattern`.
- [ ] **Future**: per-garment-category grade rules (CB / CF / HPS / hem / armhole grade points instead of uniform scaling).

## Phase 4 — Cloth sim with NVIDIA Warp

Stitch the 2D panels, drape under gravity (optional avatar mesh), surface fit metrics.

- [x] `lib/stitch-graph.ts` — ear-clipping triangulation + stitch-edge resampling. Pure TS, zero deps.
- [x] `runpod/cloth-sim/handler.py` — Warp XPBD: builds particle system from panels, adds tri / edge / stitch / contact constraints, runs 80 substeps, exports a single stitched GLB + metrics.
- [x] `runpod/cloth-sim/Dockerfile` — `warp-lang==1.5.0` on CUDA 12.4.
- [x] GH Actions matrix builds `ghcr.io/<owner>/garmentor-cloth-sim:latest`.
- [x] Deploy script provisions `garmentor-cloth-sim` endpoint, writes `RUNPOD_CLOTH_SIM_ENDPOINT_URL`.
- [x] `lib/cloth-sim.ts` client wrapper; saves draped GLB under `public/generated/{id}.draped.glb`.
- [x] `/api/chat` `drape_pattern` tool — loads a prior GCD by `patternId`, calls cloth-sim, attaches draped GLB to the workspace model.
- [x] `components/fit-viewer.tsx` — R3F renderer with metrics bar (max stretch / max compression / mean stretch) and verdict pill (pulling / excess / good).
- [x] Workspace **Fit** tab (gated until `drapedGlbUrl` exists).
- [x] `chat.tsx` `DrapeToolPart` streams progress and calls `attachDrape` on success.
- [ ] GHCR build green (run `25653859417`).
- [ ] Deploy script run.
- [ ] First successful drape in browser.

## Phase 5 — Critic loop (agentic refinement)

Self-correcting pipeline: pattern + mesh + sim fan out concurrently, a critic scores them, a modifier proposes grade deltas, re-sim, repeat up to 3 cycles. Native implementation (no BeeAI dep yet).

- [ ] `lib/agents/critic.ts` — JSON-only LLM call: input = `{ pattern, drapeMetrics, referenceMeasurement?, meshSilhouette? }`, output = `{ should_modify: bool, deltas: { panel?: name, chest_cm?, length_cm?, sleeve_cm?, … }, reason: string }`.
- [ ] `lib/agents/modifier.ts` — applies deltas to a `GcdPattern` by translating panel edges (CB / CF / hem grade points) instead of uniform scaling.
- [ ] `lib/workflow/refine-pattern.ts` — orchestrator: critic ↔ modifier ↔ cloth-sim loop, 3-iteration cap, early-exit when critic says "good fit", returns the final pattern + drape + per-cycle metric history.
- [ ] `/api/chat` `refine_pattern` tool — wraps the workflow. UI gets a streamed sequence of "cycle N: max stretch X.YY → modifying chest +3 cm" status lines.
- [ ] `components/chat.tsx` `RefineToolPart` — renders the per-cycle log + final verdict.
- [ ] System prompt instructs the assistant: after the user supplies a reference measurement, call `refine_pattern` instead of plain `generate_pattern` when accuracy matters.

## Phase 6 — Manufacturability gates

Three parallel agents that block DXF export if the pattern is unfit for cutting / sewing / costing.

- [ ] **Cuttability Agent** (`lib/gates/cuttability.ts`):
  - panel overlap test (axis-aligned bbox + polygon SAT) when panels are laid out on a 150 cm × ∞ fabric
  - min edge curvature radius ≥ 2 mm (so cutters can follow it)
  - panel polygon is simple (no self-intersection)
- [ ] **Yardage Agent** (`lib/gates/yardage.ts`):
  - sum each panel's bounding-box area, divide by fabric width (config var, default 150 cm)
  - returns total yardage + cost estimate at `$X/yard`
  - flag if > a user-set budget
- [ ] **Stitch Agent** (`lib/gates/stitch.ts`):
  - for every stitch pair, compare arc-length of the two stitched edges
  - reject if mismatch > ±5 % (otherwise the seam buckles or can't close)
- [ ] `lib/gates/run-all.ts` runs the three in `Promise.all` and aggregates `{ pass: bool, failures: [{ agent, message, panelHint? }] }`.
- [ ] `components/gates-panel.tsx` — top-of-PatternViewer banner that shows pass / fail per agent.
- [ ] `Export DXF` button disabled while gates fail; tooltip lists the failures.
- [ ] Optional: `lib/agents/cost-estimator.ts` — multiplies yardage by a fabric-cost config and shows a $$ number in the gates panel.

## Phase 7 — Multi-view consensus

If the user attaches 2 or 3 photos (front / back / side), fan out a Pattern Agent per view and reconcile.

- [ ] `components/chat-input.tsx` — accept up to 3 image files (file input `multiple` attribute + thumbnails row).
- [ ] `/api/chat` `generate_pattern_multiview` tool — calls GarmentGPT once per attached image in parallel.
- [ ] `lib/agents/reconciler.ts` — matches panels across views by name + topology, picks the median W × H per shared panel, keeps unique panels from each view (e.g. back center seam only appears in the back-view pattern).
- [ ] Reconciled GCD is what gets passed to the cloth-sim / DXF export.
- [ ] UI surfaces "merged from 3 views" in the PatternToolPart result with a hover that shows the per-view contribution.

---

## Open infra todos

- [ ] Worker quota cleanup: delete the old broken Quick Deploy chat endpoint `xezftfvzsmw722` (UI; I can't unilaterally).
- [ ] Phase 4 builds finish on GHCR.
- [ ] Run `bun scripts/runpod-create-endpoints.ts` once builds are green. Writes 4 endpoint URLs to `.env.local`.
- [ ] Rotate the Anthropic API key + RunPod API key that ended up in chat history.
- [ ] First end-to-end browser test: attach jacket photo, ask for pattern + drape, see panels + Fit verdict.

## Anti-patterns to keep avoiding

- Don't bake model weights into Docker images (~30 GB images). Always download at first run; let RunPod cache them.
- Don't pass tools to vLLM endpoints that lack `--enable-auto-tool-choice` — they hang then 524.
- Don't rely on AI SDK's `streamText` to surface model errors when tools are passed; add explicit `onError` + `onFinish` logging.
- Don't inline API keys in shell commands; the harness redacts them but it's still bad hygiene.
