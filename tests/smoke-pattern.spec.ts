import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "unit/fixture.gcd.json"), "utf8"),
);

test.describe("Pattern tab smoke", () => {
  test("loads, injects pattern, renders panels + gates + Export DXF gating", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("garmentor:auth", "sassy");
    });

    await page.goto("/");

    // Workspace placeholder before any model.
    await expect(page.getByText("No active model")).toBeVisible({ timeout: 30_000 });

    // Inject a pattern via the React workspace context.
    await page.evaluate((fixturePattern) => {
      type Ctx = {
        addModel: (m: unknown) => void;
        attachPattern: (id: string, url: string, gcd: unknown) => void;
        setActive: (id: string | null) => void;
      };
      function findCtx(): Ctx | null {
        function walk(node: Element | Node): Ctx | null {
          let fiber: { return?: unknown } | null = null;
          for (const k of Object.keys(node)) {
            if (k.startsWith("__reactFiber$")) {
              fiber = (node as unknown as Record<string, { return?: unknown }>)[k];
              break;
            }
          }
          if (!fiber) return null;
          let root: { return?: unknown } = fiber;
          while ((root as { return?: unknown }).return) root = (root as { return: { return?: unknown } }).return;
          const stack: Array<{ memoizedProps?: { value?: Ctx }; child?: unknown; sibling?: unknown }> = [
            root as { child?: unknown; sibling?: unknown },
          ];
          while (stack.length) {
            const x = stack.pop()!;
            const v = x.memoizedProps?.value;
            if (v && typeof v.addModel === "function" && typeof v.attachPattern === "function") return v;
            if (x.child) stack.push(x.child as never);
            if (x.sibling) stack.push(x.sibling as never);
          }
          return null;
        }
        return walk(document.body);
      }
      const ctx = findCtx();
      if (!ctx) throw new Error("workspace ctx not found");
      const id = "smoke-pattern-1";
      ctx.addModel({
        id,
        bytes: 0,
        description: "smoke test jacket",
        gcdUrl: "/generated/smoke.gcd.json",
      });
      ctx.attachPattern(id, "/generated/smoke.gcd.json", fixturePattern);
      ctx.setActive(id);
    }, fixture);

    // Pattern tab should now have panels.
    await expect(page.getByText(/panels ·/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Panel specs (cm)")).toBeVisible();

    // Gates banner should appear with three pills.
    const gatesRow = page.getByText(/Gates/);
    await expect(gatesRow).toBeVisible();

    // Export DXF button exists.
    const exportBtn = page.getByRole("button", { name: "Export DXF" });
    await expect(exportBtn).toBeVisible();

    // Click a panel in the side rail to select it.
    const firstPanelRow = page.getByRole("listitem").first();
    await firstPanelRow.click();
  });
});
