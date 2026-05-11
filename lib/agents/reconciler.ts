/**
 * Reconciler agent: merge multiple GCD patterns (one per photo view) into
 * a single best-guess pattern.
 *
 * Rules:
 *   - Panels with the same name across views → take the *median* W × H,
 *     compute a scale factor per dim, apply uniformly about centroid.
 *   - Panels that appear in only one view → keep as-is.
 *   - Stitches: union, deduped by (panelA, edgeA) ↔ (panelB, edgeB) pair.
 */

import type { GcdPattern, GcdPanel } from "@/lib/garment-gpt";
import { panelToPolyline } from "@/lib/gcd-to-dxf";

type Vec2 = [number, number];

function bbox(verts: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of verts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function panelWH(panel: GcdPanel): { w: number; h: number } {
  const poly = panelToPolyline(panel);
  if (poly.length === 0) return { w: 0, h: 0 };
  const b = bbox(poly);
  return { w: b.maxX - b.minX, h: b.maxY - b.minY };
}

function scalePanel(panel: GcdPanel, sx: number, sy: number): GcdPanel {
  const next: GcdPanel = JSON.parse(JSON.stringify(panel));
  const b = bbox(panel.vertices as Vec2[]);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  next.vertices = panel.vertices.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
  return next;
}

export function reconcilePatterns(patterns: GcdPattern[]): GcdPattern {
  if (patterns.length === 0) throw new Error("no patterns to reconcile");
  if (patterns.length === 1) return patterns[0];

  // Index panels by name across all views.
  const byName = new Map<string, Array<{ panel: GcdPanel; w: number; h: number }>>();
  for (const pat of patterns) {
    for (const [name, panel] of Object.entries(pat.pattern.panels)) {
      const { w, h } = panelWH(panel);
      const list = byName.get(name) ?? [];
      list.push({ panel, w, h });
      byName.set(name, list);
    }
  }

  // Build the merged pattern using the first pattern as the structural base.
  const base = patterns[0];
  const merged: GcdPattern = JSON.parse(JSON.stringify(base));

  // Merge / replace panels.
  for (const [name, occurrences] of byName) {
    if (occurrences.length === 1) {
      merged.pattern.panels[name] = occurrences[0].panel;
      continue;
    }
    const targetW = median(occurrences.map((o) => o.w));
    const targetH = median(occurrences.map((o) => o.h));
    // Use the panel whose dimensions are closest to the median as the structural source.
    let best = occurrences[0];
    let bestDist = Infinity;
    for (const o of occurrences) {
      const d = Math.abs(o.w - targetW) + Math.abs(o.h - targetH);
      if (d < bestDist) {
        bestDist = d;
        best = o;
      }
    }
    const sx = best.w > 0 ? targetW / best.w : 1;
    const sy = best.h > 0 ? targetH / best.h : 1;
    merged.pattern.panels[name] = scalePanel(best.panel, sx, sy);
  }

  // Ensure panel_order includes every merged panel.
  const seen = new Set<string>();
  const order: string[] = [];
  for (const pat of patterns) {
    for (const n of pat.pattern.panel_order ?? Object.keys(pat.pattern.panels)) {
      if (!seen.has(n) && merged.pattern.panels[n]) {
        order.push(n);
        seen.add(n);
      }
    }
  }
  merged.pattern.panel_order = order;

  // Merge stitches, deduped.
  const stitchKey = (s: GcdPattern["pattern"]["stitches"][number]) =>
    s.map((e) => `${e.panel}#${e.edge}`).sort().join("|");
  const stitchSet = new Map<string, GcdPattern["pattern"]["stitches"][number]>();
  for (const pat of patterns) {
    for (const st of pat.pattern.stitches ?? []) {
      stitchSet.set(stitchKey(st), st);
    }
  }
  merged.pattern.stitches = Array.from(stitchSet.values());

  return merged;
}
