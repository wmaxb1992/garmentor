import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const SAMPLE = resolve(process.cwd(), "public/jacketsample.png");

test("upload jacketsample.png and generate a 3D model", async ({ page }) => {
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") {
      console.log(`[console.${t}]`, m.text());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Garmentor" })).toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(SAMPLE);
  await expect(page.getByAltText("attachment preview")).toBeVisible();

  const textarea = page.locator("textarea");
  await textarea.fill(
    "Here is a jacket photo. Treat it as ghost-mannequin even if it looks flat — proceed and call generate_3d_model now. Skip clarifying questions.",
  );

  await page.getByRole("button", { name: "Send" }).click();

  // The user message bubble should now contain our preview image.
  await expect(page.locator('img[alt="attachment preview"]')).toHaveCount(0);

  // Tool placeholder appears while Modal is running.
  const toolPending = page.getByText(/Generating 3D model/i);
  await expect(toolPending).toBeVisible({ timeout: 60_000 });
  console.log("[e2e] tool placeholder visible — Modal request in flight");

  // Wait for the GLB viewer canvas OR a download link OR an error.
  const canvas = page.locator("canvas");
  const downloadLink = page.getByRole("link", { name: /Download \.glb/i });
  const errorBox = page.locator("text=/Modal generate endpoint returned/i");

  await Promise.race([
    canvas.first().waitFor({ state: "visible", timeout: 4 * 60_000 }),
    downloadLink.waitFor({ state: "visible", timeout: 4 * 60_000 }),
    errorBox.waitFor({ state: "visible", timeout: 4 * 60_000 }),
  ]);

  if (await errorBox.isVisible().catch(() => false)) {
    const msg = await errorBox.textContent();
    throw new Error(`Tool returned an error: ${msg}`);
  }

  await expect(downloadLink).toBeVisible({ timeout: 4 * 60_000 });
  const href = await downloadLink.getAttribute("href");
  expect(href).toMatch(/^\/generated\/.+\.glb$/);
  console.log(`[e2e] GLB rendered, download href = ${href}`);

  await page.screenshot({
    path: "tests/screenshots/garmentor-result.png",
    fullPage: true,
  });
});
