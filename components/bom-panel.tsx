"use client";

import { useMemo } from "react";
import { panelToPolyline } from "@/lib/gcd-to-dxf";
import { useActiveModel } from "@/lib/workspace-store";

type Row = { name: string; width: number; height: number };

export function BomPanel() {
  const active = useActiveModel();
  const rows: Row[] = useMemo(() => {
    if (!active?.gcd) return [];
    const order = active.gcd.pattern.panel_order?.length
      ? active.gcd.pattern.panel_order
      : Object.keys(active.gcd.pattern.panels);
    return order
      .map((name) => {
        const p = active.gcd!.pattern.panels[name];
        if (!p) return null;
        const poly = panelToPolyline(p);
        if (poly.length < 2) return null;
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const [x, y] of poly) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        return { name, width: maxX - minX, height: maxY - minY };
      })
      .filter((r): r is Row => r !== null);
  }, [active]);

  if (!active) {
    return (
      <div className="h-full overflow-auto rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Bill of Materials
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Generate a pattern to populate the BoM.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Bill of Materials
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          No pattern attached to this item yet.
        </p>
      ) : (
        <ul className="space-y-1 text-xs">
          <li className="flex justify-between border-b border-zinc-200 pb-1 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <span>Panel</span>
            <span>W × H (cm)</span>
          </li>
          {rows.map((r) => (
            <li
              key={r.name}
              className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-800"
            >
              <span className="truncate pr-2 text-zinc-700 dark:text-zinc-200">
                {r.name}
              </span>
              <span className="shrink-0 font-medium text-zinc-900 dark:text-zinc-100">
                {r.width.toFixed(1)} × {r.height.toFixed(1)}
              </span>
            </li>
          ))}
          <li className="mt-2 flex justify-between text-zinc-500 dark:text-zinc-400">
            <span>Total panels</span>
            <span className="font-medium">{rows.length}</span>
          </li>
        </ul>
      )}
    </div>
  );
}
