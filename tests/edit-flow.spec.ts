import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const SAMPLE = resolve(process.cwd(), "public/jacketsample.png");

test("edit jacket image then regenerate 3D from edited mockup", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);

  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") {
      console.log(`[console.${t}]`, m.text());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Garmentor" })).toBeVisible();

  // 1. Upload sample jacket photo.
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(SAMPLE);
  await expect(page.getByAltText("attachment preview")).toBeVisible();

  // 2. Ask for an edit (mockup) — assistant must call edit_garment_image.
  const textarea = page.locator("textarea");
  await textarea.fill(
    "This is a ghost-mannequin jacket photo. Edit it: remove the pockets, keep everything else identical. Call edit_garment_image now — do not ask clarifying questions.",
  );
  await page.getByRole("button", { name: "Send" }).click();

  // Pending placeholder visible while Modal is running the edit.
  const editPending = page.getByText(/Editing the garment image/i);
  await expect(editPending).toBeVisible({ timeout: 60_000 });
  console.log("[e2e] edit tool placeholder visible — Modal edit in flight");

  // 3. Wait for the edit result: a Download (NN KB) link.
  const editDownload = page.getByRole("link", { name: /Download \(\d+\s*KB\)/i });
  const editError = page
    .locator("div")
    .filter({ hasText: /Modal edit endpoint returned|Tool failed/i })
    .first();

  await Promise.race([
    editDownload.first().waitFor({ state: "visible", timeout: 5 * 60_000 }),
    editError.waitFor({ state: "visible", timeout: 5 * 60_000 }),
  ]);

  if (await editError.isVisible().catch(() => false)) {
    const msg = await editError.textContent();
    throw new Error(`Edit tool returned an error: ${msg}`);
  }

  const editedHref = await editDownload.first().getAttribute("href");
  expect(editedHref).toMatch(/^\/generated\/.+\.png$/);
  console.log(`[e2e] edited mockup ready, href = ${editedHref}`);

  await page.screenshot({
    path: "tests/screenshots/edit-flow-mockup.png",
    fullPage: true,
  });

  // 4. Approve and ask for 3D regen from the edited image.
  await textarea.fill(
    "Looks great. Regenerate the 3D model from that edited image now — call generate_3d_model with the imageUrl from the edit result.",
  );
  await page.getByRole("button", { name: "Send" }).click();

  const meshPending = page.getByText(/Generating 3D model/i);
  await expect(meshPending).toBeVisible({ timeout: 60_000 });
  console.log("[e2e] 3D tool placeholder visible — Modal mesh in flight");

  // 5. Wait for the GLB result.
  const glbDownload = page.getByRole("link", { name: /Download \.glb/i });
  const meshError = page.locator("text=/Modal generate endpoint returned/i");

  await Promise.race([
    glbDownload.first().waitFor({ state: "visible", timeout: 5 * 60_000 }),
    meshError.waitFor({ state: "visible", timeout: 5 * 60_000 }),
  ]);

  if (await meshError.isVisible().catch(() => false)) {
    const msg = await meshError.textContent();
    throw new Error(`3D tool returned an error: ${msg}`);
  }

  await expect(glbDownload.first()).toBeVisible();
  const glbHref = await glbDownload.first().getAttribute("href");
  expect(glbHref).toMatch(/^\/generated\/.+\.glb$/);
  console.log(`[e2e] GLB ready from edited image, href = ${glbHref}`);

  await page.screenshot({
    path: "tests/screenshots/edit-flow-result.png",
    fullPage: true,
  });

  // 6. Workspace fabric picker smoke check — model auto-becomes active.
  const fabricSelect = page.locator("select").filter({ hasText: /Original/ });
  await fabricSelect.waitFor({ state: "visible", timeout: 30_000 });
  const initial = await fabricSelect.inputValue();
  expect(initial).toBe("default");
  await fabricSelect.selectOption("denim");
  expect(await fabricSelect.inputValue()).toBe("denim");
  await fabricSelect.selectOption("silk");
  expect(await fabricSelect.inputValue()).toBe("silk");
  await fabricSelect.selectOption("default");
  console.log("[e2e] fabric picker swap OK (default → denim → silk → default)");

  // 7. Seam-graph readiness: Draw seam button enables once the GLB has loaded
  //    in the workspace and buildSeamGraph has produced a graph.
  const drawBtn = page.getByRole("button", { name: /Draw seam|Drawing/ });
  await expect(drawBtn).toBeEnabled({ timeout: 60_000 });
  await drawBtn.click();
  await expect(drawBtn).toHaveText(/Drawing/);
  await drawBtn.click();
  await expect(drawBtn).toHaveText(/Draw seam/);
  console.log("[e2e] seam-graph ready, Draw seam toggle works");

  // 7b. Auto-detect seams from the GLB's baked texture. The button stays
  //     disabled until luminance has been sampled. We don't assert on the
  //     specific seam count (depends on the model) but expect at least one to
  //     appear when the texture has any dark regions.
  const autoBtn = page.getByRole("button", { name: /Auto-detect seams|Detecting/ });
  if (await autoBtn.isEnabled().catch(() => false)) {
    const seamCountBefore = await page.locator("text=/\\d+ seams?/").innerText();
    await autoBtn.click();
    await expect(autoBtn).toHaveText(/Auto-detect seams/, { timeout: 30_000 });
    const seamCountAfter = await page.locator("text=/\\d+ seams?/").innerText();
    console.log(`[e2e] auto-detect: ${seamCountBefore} -> ${seamCountAfter}`);
  } else {
    console.log("[e2e] auto-detect button disabled (no baked texture) — skipped");
  }

  // 8. Phase 2.5 — switch to Flat sketch tab, verify SVG renders and the
  //    measurements panel is populated.
  await page.getByRole("button", { name: "Flat sketch" }).click();
  const sketchSvg = page.locator("svg").first();
  await expect(sketchSvg).toBeVisible({ timeout: 30_000 });
  // Sketch should contain at least one <path> from the silhouette.
  const pathCount = await page.locator("svg path").count();
  expect(pathCount).toBeGreaterThan(0);
  // Measurements panel labels.
  await expect(page.getByText("Length", { exact: true })).toBeVisible();
  await expect(page.getByText("Chest girth", { exact: true })).toBeVisible();
  // Export SVG button is present and clickable (we don't intercept the
  // download here — just ensure it doesn't throw).
  const exportBtn = page.getByRole("button", { name: "Export SVG" });
  await expect(exportBtn).toBeEnabled();
  console.log("[e2e] flat sketch SVG + measurements + export button OK");

  await page.screenshot({
    path: "tests/screenshots/edit-flow-fabric.png",
    fullPage: true,
  });
});
