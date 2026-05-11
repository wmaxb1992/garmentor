<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project: Garmentor

Photo → 3D mesh → user-drawn seams → cut into pieces → flatten each piece → DXF
pattern export. A "ChatGPT-like" assistant wraps the whole pipeline.

Stack (do not swap without explicit user approval):
- Next.js 16 (App Router, Turbopack default), React 19, TypeScript, Tailwind v4
- Bun (package manager AND lockfile — never npm/yarn/pnpm)
- AI SDK v6 (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`); chat model `claude-sonnet-4-5`
- Three.js + `@react-three/fiber` + `@react-three/drei` for the 3D viewer
- Modal (Python, GPU `L40S`) for image-to-3D using Hunyuan3D-2

Repo layout (flat — no `src/`):
```
app/         # Next.js routes, including app/api/*/route.ts
components/  # React client components
lib/         # Server/client utilities (no React)
modal/       # Python Modal app (separate deploy)
public/      # generated/ and uploads/ are gitignored
```

# Hard rules (do not violate without explicit user approval)

1. **Bun only.** Use `bun add` / `bun remove` / `bun run`. Never `npm`, `yarn`,
   or `pnpm`. Never edit `package.json` `dependencies` by hand.
2. **No new heavy deps.** No shadcn/ui, no Radix, no MUI, no Chakra, no
   styled-components, no Redux, no Zustand, no Tanstack Query, no Prisma,
   no NextAuth. Plain Tailwind + React state + `useChat` are sufficient.
3. **Stay in phase.** See Roadmap below. Do not start a later phase's work
   while an earlier phase is unfinished. Ask the user before jumping phases.
4. **Don't change the architecture.** The pipeline (image → Modal → GLB →
   seams → cut → flatten → DXF) is fixed. Do not propose alternative
   providers, alternative ML models, or alternative export formats unless
   the user asks.
5. **Don't deploy or pay money.** Never run `modal deploy`, `vercel deploy`,
   `bun publish`, or anything that bills the user. Never commit, push, merge,
   rebase, or change ticket/PR state without explicit permission.
6. **No new docs files.** Do not create `README.md`, `CONTRIBUTING.md`,
   `CHANGELOG.md`, or any `.md` outside what already exists. This `AGENTS.md`
   is the single source of project doc.
7. **Verify SDK signatures from disk.** Your training data is older than the
   installed packages. Before calling any function from `ai`, `@ai-sdk/*`,
   `@react-three/drei`, or `next`, read the live `*.d.ts` in `node_modules/`.
   Especially: `convertToModelMessages` is async (`await` it), `useChat`
   needs `transport: new DefaultChatTransport({api: ...})`, message content
   lives in `message.parts` (not `message.content`).
8. **No `any` / `@ts-ignore` to "make it work".** Fix the type properly.
9. **No file moves or renames** of anything that already exists, unless the
   user asks for it.
10. **No `src/` directory.** Keep the flat layout above.
11. **Env vars** belong in `.env.example` (committed) and `.env.local`
    (gitignored). Add new vars to `.env.example` whenever code reads them.
12. **The Modal `app.py` is sensitive.** Don't refactor it casually — its
    pip versions and the `hy3dgen` import surface are pinned for a reason.
    Edits to it require a `modal deploy` (cost + 15–30 min). Ask first.

# Pre-edit checklist (run through every time before writing code)

- [ ] Which **Phase** does this task belong to? If it's not the current phase,
      stop and ask the user.
- [ ] Search the codebase with `codebase-retrieval` and `view` for every
      symbol you'll touch. Confirm signatures, callers, and existing patterns.
- [ ] If editing Next.js code, open the matching doc in
      `node_modules/next/dist/docs/01-app/`.
- [ ] If editing AI SDK code, open the matching doc in
      `node_modules/ai/docs/04-ai-sdk-ui/` (client) or `03-ai-sdk-core/`
      (server). For Anthropic specifics: `node_modules/@ai-sdk/anthropic/docs/`.
- [ ] If editing R3F / drei, confirm the component/hook exists by listing
      `node_modules/@react-three/drei/`.
- [ ] If a new dep is genuinely needed, **ask the user first** before
      `bun add`-ing it.

# Post-edit checklist (every code change)

- [ ] `bun run build` succeeds (TS + Next.js + Turbopack). Don't declare
      done on type-check alone — Next.js does additional checks at build.
- [ ] `diagnostics` returns no issues on every file you touched.
- [ ] No unused imports, no dead code, no console.logs left behind.
- [ ] If you added an env var, it's in `.env.example` with a comment.
- [ ] If you changed a public function signature, every caller is updated
      in the same change (use `codebase-retrieval` to find them all).
- [ ] If the change affects the chat flow (system prompt, tool schema, tool
      result shape), the corresponding renderer in `components/chat.tsx`
      is updated.

# Roadmap

## ✅ Phase 1 — Chat + image-to-3D (DONE)
- ChatGPT-style UI streams from `/api/chat` (Anthropic).
- User attaches a photo; assistant calls `generate_3d_model` tool.
- Tool POSTs image to Modal Hunyuan3D-2 endpoint, saves `.glb` under
  `public/generated/`, returns the URL.
- Inline R3F viewer renders the GLB in the assistant's message.

## ⏳ Phase 2 — Seam drawing on the mesh (NEXT)
**Definition of Done:**
- Two-pane layout: chat (left, ~40% width), seam-editing workspace (right).
  Inline chat viewers become read-only thumbnails with a "Set as active" button.
  Mobile fallback: stacked with a tab toggle.
- Workspace renders the *currently active* model in a large R3F viewer with a
  "Draw seam" mode toggle and per-seam controls.
- Click on the mesh in draw mode drops a vertex-snapped point; consecutive
  points are joined by the geodesic shortest path along mesh edges
  (Dijkstra on the half-edge graph weighted by edge length).
- Multiple seam polylines per model; each can be undone or cleared individually,
  plus a "Clear all" button.
- Visual: highlighted edges in a contrasting color; points as small spheres at
  each clicked vertex.
- **Persistence:** all generated models + their seams stored in a global React
  context, hydrated from `localStorage` (key `garmentor:workspace:v1`, capped at
  the 50 most recent models). Seams persist across page reloads and across new
  generations.
- "Current model" defaults to the most recently generated; user can switch by
  clicking "Set as active" on any chat viewer thumbnail.
- No backend changes required for this phase.

## ⏳ Phase 2.5 — Tech-pack flat sketch view (NEXT)
**Definition of Done:**
- Workspace right pane gains a tabbed view: **Seam editor** (existing) and
  **Flat sketch** (new). Same active model, same seams, two presentations.
- Flat sketch is rendered from the *current mesh + drawn seams*, not from a
  separate AI image gen. No new model providers.
- Renders front + back orthographic projections side by side:
  1. Silhouette outline of the mesh.
  2. Crease edges via `THREE.EdgesGeometry` with a configurable
     `thresholdAngle` (default ~25°) drawn as thin black lines.
  3. User-drawn seam polylines projected into the same orthographic frame
     and drawn in a contrasting color (e.g. orange dashed) above the
     silhouette.
- Auto-extracted measurements panel (read-only): chest girth at the widest
  cross-section, total length, sleeve length when applicable. Computed
  from the mesh; never user-editable in this phase.
- "Export SVG" button exports the front+back composite as a single vector
  SVG file suitable for inclusion in a tech pack.
- No backend changes; pure client-side rendering using existing Three.js
  and the `lib/glb-mesh.ts` extracted geometry.

## ⏳ Phase 3 — Cut + flatten + DXF export
**Definition of Done:**
- New Python sidecar (extend `modal/app.py` with a second class, OR a
  separate local FastAPI service — decide with the user) using
  `trimesh` + `libigl`.
- Endpoint: `POST /flatten` with `{ glbUrl, seams: [...] }` →
  returns `{ pieces: [{ id, dxf: string }] }` after:
  1. cutting the mesh along seam polylines (vertex duplication +
     connected-component split),
  2. flattening each component with LSCM (`igl.lscm`) or ARAP,
  3. emitting each 2D outline as DXF `LWPOLYLINE` entities.
- UI: "Export DXF" button beside the viewer; downloads a zip of `.dxf`s.

## ⏳ Phase 4 — Avatar fit + rigging + cloth sim with pattern feedback

Production garment-design layer. Each sub-phase depends on the previous.
Do **not** start any of these until Phase 3 is complete — without DXF panels,
there is nothing real to simulate or fit.

### Phase 4a — Stock avatar reference under the garment
- Add a parametric body model (SMPL-X or similar, both free) rendered as a
  translucent reference shape inside the workspace viewer.
- Solve mesh registration: scale + rotate + translate the Hunyuan3D-2 garment
  so it sits correctly on the avatar (chest-to-chest, shoulder-to-shoulder).
- UI: toggle for avatar visibility; sliders for stock body parameters
  (height, chest, waist, hips). No physics, no rigging, no sim yet.

### Phase 4b — Rigged avatar with pose controls
- Avatar comes with a skeleton (SMPL-X has 55 joints).
- UI: pose controls — at minimum, raise/lower arms, rotate torso, sit/stand.
- Garment moves with the body via **linear blend skinning**: auto-compute
  skin weights so jacket vertices follow nearest body bones. No fabric drape;
  this is the "rigid follow" baseline before real cloth sim.

### Phase 4c — Real-time cloth simulation with pattern feedback loop
- Cloth solver (XPBD in a Web Worker, OR Python sidecar with NVIDIA Warp /
  Taichi — decide with the user; trade-off is browser cost vs. server cost).
- Re-stitch the Phase 3 DXF panels in the simulator: position around the avatar,
  define seam constraints from saved seam polylines, run drape under gravity.
- Body is a collider; jacket is cloth; arm-raise pose triggers re-simulation.
- **Pattern feedback loop:** when sim shows fit issues (pulling, pinching,
  excess fabric), surface them in UI; user adjusts seam placement in the
  workspace; re-cut + re-flatten + re-sim until satisfied.

### Phase 4d — Three-pane production layout + configurator
Final UI form once 4a–4c land. Replaces the two-pane workspace.
- **Left pane:** avatar wearing the garment (4a body + 4c draped cloth).
- **Top-right pane:** Phase 2.5 flat sketch, now also showing the Phase 3
  flattened panel outlines as a real cutting layout preview.
- **Bottom-right pane:** configurator with three tabs:
  1. **Color** — material tint picker (trivially available earlier; gated
     here only so the configurator ships as one unit).
  2. **Fabric** — PBR material library (denim, silk, leather, wool, …)
     with normal/roughness maps. Affects both the draped left-pane render
     and the top-right flat sketch fill.
  3. **Specs** — measurement sliders that **re-grade the Phase 3 DXF
     panels** (the only honest place to change spec; the mesh itself is
     not parametric). Re-grading triggers re-flatten + re-sim.
- "Export tech pack" button: zips the SVG flat sketch + DXF panels +
  measurement table into a single downloadable bundle.

### Phase 4e — Misc polish (only if explicitly requested)
- Multi-chat persistence, per-project storage, auth, hosted deploy,
  DXF revisions, etc.

# Anti-patterns observed before — do not repeat

- Adding `@ts-ignore` to silence `convertToModelMessages` returning a
  Promise. **Always `await` it.**
- Reading `message.content` instead of iterating `message.parts`.
- Hardcoding an Anthropic model that doesn't exist anymore. Use the env
  var and the default `claude-sonnet-4-5`.
- Using `next dev --turbopack` flag (Next 16 has it on by default).
- Treating the AI SDK v4 `useChat({ api })` shape as current — v6 requires
  `transport: new DefaultChatTransport({ api })`.
- Synchronous `cookies()`, `headers()`, `params` access — all are async
  in Next 16.
