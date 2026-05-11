# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: edit-flow.spec.ts >> edit jacket image then regenerate 3D from edited mockup
- Location: tests/edit-flow.spec.ts:6:5

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator:  getByRole('button', { name: /Draw seam|Drawing/ })
Expected: enabled
Received: disabled
Timeout:  60000ms

Call log:
  - Expect "toBeEnabled" with timeout 60000ms
  - waiting for getByRole('button', { name: /Draw seam|Drawing/ })
    55 × locator resolved to <button disabled type="button" class="rounded-md border px-3 py-1.5 text-sm font-medium transition border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800">Draw seam</button>
       - unexpected value "disabled"

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e4]:
      - generic [ref=e6]:
        - generic [ref=e8]:
          - generic [ref=e10]:
            - img "jacketsample.png" [ref=e11]
            - paragraph [ref=e12]: "This is a ghost-mannequin jacket photo. Edit it: remove the pockets, keep everything else identical. Call edit_garment_image now — do not ask clarifying questions."
          - generic [ref=e14]:
            - generic [ref=e15]:
              - img "Remove all pockets from the jacket (the two chest patch pockets, the right chest welt pocket, and the two lower patch pockets). Keep the collar, sleeves, buttons, color, material, and all other details identical." [ref=e16]
              - generic [ref=e17]:
                - generic [ref=e18]: Remove all pockets from the jacket (the two chest patch pockets, the right chest welt pocket, and the two lower patch pockets). Keep the collar, sleeves, buttons, color, material, and all other details identical.
                - link "Download (597 KB)" [ref=e19] [cursor=pointer]:
                  - /url: /generated/5ijgUcDe6DlE.png
            - paragraph [ref=e20]: Pockets removed. The edited mockup shows the green suede jacket with black leather trim and no pockets—buttons and collar remain intact. Does this look good to you, or would you like any adjustments before generating the 3D model?
          - paragraph [ref=e23]: Looks great. Regenerate the 3D model from that edited image now — call generate_3d_model with the imageUrl from the edit result.
          - generic [ref=e25]:
            - generic [ref=e31]:
              - link "Download .glb (12537 KB)" [ref=e32] [cursor=pointer]:
                - /url: /generated/Hm5L13djaelg.glb
              - button "Active in workspace" [disabled] [ref=e33]
            - paragraph [ref=e34]: 3D model generated from the edited image. The mesh now reflects the pocket-free version of the jacket with all the collar and trim details intact. If you have a known reference measurement (e.g., back length or chest width), let me know so the model can be scaled accurately later.
        - generic [ref=e35]:
          - generic [ref=e36]:
            - textbox "Attach a photo, then ask for a 3D model…" [active] [ref=e37]
            - generic [ref=e38]:
              - button "Attach image" [ref=e39]:
                - img [ref=e40]
              - button "Send" [disabled] [ref=e44]:
                - img [ref=e45]
          - paragraph [ref=e48]: Phase 1 · image → 3D mesh. Seam drawing & DXF export coming next.
      - generic [ref=e50]:
        - generic [ref=e51]:
          - generic [ref=e52]:
            - generic [ref=e53]: green suede jacket with black leather trim, no pockets, front view
            - generic [ref=e54]: Hm5L13djaelg.glb
          - generic [ref=e55]:
            - button "Seam editor" [ref=e56]
            - button "Flat sketch" [ref=e57]
        - generic [ref=e60]:
          - button "Draw seam" [disabled] [ref=e61]
          - button "Undo point" [disabled] [ref=e62]
          - button "Finish seam" [disabled] [ref=e63]
          - button "Cancel" [disabled] [ref=e64]
          - button "Auto-detect seams" [disabled] [ref=e65]
          - generic [ref=e66]:
            - generic [ref=e67]:
              - text: Fabric
              - combobox "Fabric" [ref=e68]:
                - option "Original" [selected]
                - option "Cotton"
                - option "Denim"
                - option "Leather"
                - option "Silk"
                - option "Wool"
                - option "Linen"
            - generic [ref=e69]: 0 seams
            - button "Clear all" [disabled] [ref=e70]
  - button "Open Next.js Dev Tools" [ref=e80] [cursor=pointer]:
    - img [ref=e81]
  - alert [ref=e84]
```

# Test source

```ts
  14  |     if (t === "error" || t === "warning") {
  15  |       console.log(`[console.${t}]`, m.text());
  16  |     }
  17  |   });
  18  | 
  19  |   await page.goto("/");
  20  |   await expect(page.getByRole("heading", { name: "Garmentor" })).toBeVisible();
  21  | 
  22  |   // 1. Upload sample jacket photo.
  23  |   const fileInput = page.locator('input[type="file"]');
  24  |   await fileInput.setInputFiles(SAMPLE);
  25  |   await expect(page.getByAltText("attachment preview")).toBeVisible();
  26  | 
  27  |   // 2. Ask for an edit (mockup) — assistant must call edit_garment_image.
  28  |   const textarea = page.locator("textarea");
  29  |   await textarea.fill(
  30  |     "This is a ghost-mannequin jacket photo. Edit it: remove the pockets, keep everything else identical. Call edit_garment_image now — do not ask clarifying questions.",
  31  |   );
  32  |   await page.getByRole("button", { name: "Send" }).click();
  33  | 
  34  |   // Pending placeholder visible while Modal is running the edit.
  35  |   const editPending = page.getByText(/Editing the garment image/i);
  36  |   await expect(editPending).toBeVisible({ timeout: 60_000 });
  37  |   console.log("[e2e] edit tool placeholder visible — Modal edit in flight");
  38  | 
  39  |   // 3. Wait for the edit result: a Download (NN KB) link.
  40  |   const editDownload = page.getByRole("link", { name: /Download \(\d+\s*KB\)/i });
  41  |   const editError = page
  42  |     .locator("div")
  43  |     .filter({ hasText: /Modal edit endpoint returned|Tool failed/i })
  44  |     .first();
  45  | 
  46  |   await Promise.race([
  47  |     editDownload.first().waitFor({ state: "visible", timeout: 5 * 60_000 }),
  48  |     editError.waitFor({ state: "visible", timeout: 5 * 60_000 }),
  49  |   ]);
  50  | 
  51  |   if (await editError.isVisible().catch(() => false)) {
  52  |     const msg = await editError.textContent();
  53  |     throw new Error(`Edit tool returned an error: ${msg}`);
  54  |   }
  55  | 
  56  |   const editedHref = await editDownload.first().getAttribute("href");
  57  |   expect(editedHref).toMatch(/^\/generated\/.+\.png$/);
  58  |   console.log(`[e2e] edited mockup ready, href = ${editedHref}`);
  59  | 
  60  |   await page.screenshot({
  61  |     path: "tests/screenshots/edit-flow-mockup.png",
  62  |     fullPage: true,
  63  |   });
  64  | 
  65  |   // 4. Approve and ask for 3D regen from the edited image.
  66  |   await textarea.fill(
  67  |     "Looks great. Regenerate the 3D model from that edited image now — call generate_3d_model with the imageUrl from the edit result.",
  68  |   );
  69  |   await page.getByRole("button", { name: "Send" }).click();
  70  | 
  71  |   const meshPending = page.getByText(/Generating 3D model/i);
  72  |   await expect(meshPending).toBeVisible({ timeout: 60_000 });
  73  |   console.log("[e2e] 3D tool placeholder visible — Modal mesh in flight");
  74  | 
  75  |   // 5. Wait for the GLB result.
  76  |   const glbDownload = page.getByRole("link", { name: /Download \.glb/i });
  77  |   const meshError = page.locator("text=/Modal generate endpoint returned/i");
  78  | 
  79  |   await Promise.race([
  80  |     glbDownload.first().waitFor({ state: "visible", timeout: 5 * 60_000 }),
  81  |     meshError.waitFor({ state: "visible", timeout: 5 * 60_000 }),
  82  |   ]);
  83  | 
  84  |   if (await meshError.isVisible().catch(() => false)) {
  85  |     const msg = await meshError.textContent();
  86  |     throw new Error(`3D tool returned an error: ${msg}`);
  87  |   }
  88  | 
  89  |   await expect(glbDownload.first()).toBeVisible();
  90  |   const glbHref = await glbDownload.first().getAttribute("href");
  91  |   expect(glbHref).toMatch(/^\/generated\/.+\.glb$/);
  92  |   console.log(`[e2e] GLB ready from edited image, href = ${glbHref}`);
  93  | 
  94  |   await page.screenshot({
  95  |     path: "tests/screenshots/edit-flow-result.png",
  96  |     fullPage: true,
  97  |   });
  98  | 
  99  |   // 6. Workspace fabric picker smoke check — model auto-becomes active.
  100 |   const fabricSelect = page.locator("select").filter({ hasText: /Original/ });
  101 |   await fabricSelect.waitFor({ state: "visible", timeout: 30_000 });
  102 |   const initial = await fabricSelect.inputValue();
  103 |   expect(initial).toBe("default");
  104 |   await fabricSelect.selectOption("denim");
  105 |   expect(await fabricSelect.inputValue()).toBe("denim");
  106 |   await fabricSelect.selectOption("silk");
  107 |   expect(await fabricSelect.inputValue()).toBe("silk");
  108 |   await fabricSelect.selectOption("default");
  109 |   console.log("[e2e] fabric picker swap OK (default → denim → silk → default)");
  110 | 
  111 |   // 7. Seam-graph readiness: Draw seam button enables once the GLB has loaded
  112 |   //    in the workspace and buildSeamGraph has produced a graph.
  113 |   const drawBtn = page.getByRole("button", { name: /Draw seam|Drawing/ });
> 114 |   await expect(drawBtn).toBeEnabled({ timeout: 60_000 });
      |                         ^ Error: expect(locator).toBeEnabled() failed
  115 |   await drawBtn.click();
  116 |   await expect(drawBtn).toHaveText(/Drawing/);
  117 |   await drawBtn.click();
  118 |   await expect(drawBtn).toHaveText(/Draw seam/);
  119 |   console.log("[e2e] seam-graph ready, Draw seam toggle works");
  120 | 
  121 |   // 7b. Auto-detect seams from the GLB's baked texture. The button stays
  122 |   //     disabled until luminance has been sampled. We don't assert on the
  123 |   //     specific seam count (depends on the model) but expect at least one to
  124 |   //     appear when the texture has any dark regions.
  125 |   const autoBtn = page.getByRole("button", { name: /Auto-detect seams|Detecting/ });
  126 |   if (await autoBtn.isEnabled().catch(() => false)) {
  127 |     const seamCountBefore = await page.locator("text=/\\d+ seams?/").innerText();
  128 |     await autoBtn.click();
  129 |     await expect(autoBtn).toHaveText(/Auto-detect seams/, { timeout: 30_000 });
  130 |     const seamCountAfter = await page.locator("text=/\\d+ seams?/").innerText();
  131 |     console.log(`[e2e] auto-detect: ${seamCountBefore} -> ${seamCountAfter}`);
  132 |   } else {
  133 |     console.log("[e2e] auto-detect button disabled (no baked texture) — skipped");
  134 |   }
  135 | 
  136 |   // 8. Phase 2.5 — switch to Flat sketch tab, verify SVG renders and the
  137 |   //    measurements panel is populated.
  138 |   await page.getByRole("button", { name: "Flat sketch" }).click();
  139 |   const sketchSvg = page.locator("svg").first();
  140 |   await expect(sketchSvg).toBeVisible({ timeout: 30_000 });
  141 |   // Sketch should contain at least one <path> from the silhouette.
  142 |   const pathCount = await page.locator("svg path").count();
  143 |   expect(pathCount).toBeGreaterThan(0);
  144 |   // Measurements panel labels.
  145 |   await expect(page.getByText("Length", { exact: true })).toBeVisible();
  146 |   await expect(page.getByText("Chest girth", { exact: true })).toBeVisible();
  147 |   // Export SVG button is present and clickable (we don't intercept the
  148 |   // download here — just ensure it doesn't throw).
  149 |   const exportBtn = page.getByRole("button", { name: "Export SVG" });
  150 |   await expect(exportBtn).toBeEnabled();
  151 |   console.log("[e2e] flat sketch SVG + measurements + export button OK");
  152 | 
  153 |   await page.screenshot({
  154 |     path: "tests/screenshots/edit-flow-fabric.png",
  155 |     fullPage: true,
  156 |   });
  157 | });
  158 | 
```