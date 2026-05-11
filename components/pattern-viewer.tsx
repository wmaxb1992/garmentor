"use client";

import { useMemo, useState } from "react";
import { gcdToDxf, panelToPolyline, type DxfUnit } from "@/lib/gcd-to-dxf";
import type { GcdPattern } from "@/lib/garment-gpt";
import { useActiveModel } from "@/lib/workspace-store";

const PALETTE = [
  "#0ea5e9",
  "#22c55e",
  "#f97316",
  "#a855f7",
  "#ef4444",
  "#14b8a6",
  "#eab308",
  "#ec4899",
];

function fmtCm(v: number): string {
  return `${v.toFixed(1)} cm`;
}

export function PatternViewer() {
  const active = useActiveModel();
  const [unit, setUnit] = useState<DxfUnit>("mm");
  const pattern = active?.gcd as GcdPattern | undefined;

  const panels = useMemo(() => {
    if (!pattern) return [];
    const order = pattern.pattern.panel_order?.length
      ? pattern.pattern.panel_order
      : Object.keys(pattern.pattern.panels);
    return order
      .map((name, i) => {
        const p = pattern.pattern.panels[name];
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
        const w = maxX - minX;
        const h = maxY - minY;
        return {
          name,
          color: PALETTE[i % PALETTE.length],
          poly,
          minX,
          minY,
          width: w,
          height: h,
        };
      })
      .filter(
        (p): p is NonNullable<typeof p> => p !== null,
      );
  }, [pattern]);

  const layout = useMemo(() => {
    // Pack panels into a row-major grid for display.
    if (panels.length === 0) return null;
    const PAD = 4;
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;
    const COLS_WIDTH = 60; // cm: row wrap target
    const placed = panels.map((p) => {
      if (cursorX > 0 && cursorX + p.width > COLS_WIDTH) {
        cursorX = 0;
        cursorY += rowHeight + PAD;
        rowHeight = 0;
      }
      const tx = cursorX - p.minX;
      const ty = cursorY - p.minY;
      cursorX += p.width + PAD;
      if (p.height > rowHeight) rowHeight = p.height;
      return { ...p, tx, ty };
    });
    const totalW = Math.max(...placed.map((p) => p.tx + p.minX + p.width));
    const totalH = cursorY + rowHeight;
    return { placed, totalW, totalH };
  }, [panels]);

  const downloadDxf = () => {
    if (!pattern) return;
    const dxf = gcdToDxf(pattern, unit);
    const blob = new Blob([dxf], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active?.description?.replace(/\s+/g, "_") ?? "pattern"}.dxf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!pattern || !layout) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-50 p-8 text-center text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        <div>
          <div className="text-base font-medium text-zinc-700 dark:text-zinc-200">
            No pattern generated yet
          </div>
          <p className="mt-1 max-w-sm">
            Ask the assistant to generate a pattern from your garment photo to
            see panel pieces and export DXF.
          </p>
        </div>
      </div>
    );
  }

  const stitches = pattern.pattern.stitches ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Pattern panels
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {layout.placed.length} panels · {stitches.length} stitch
          {stitches.length === 1 ? "" : "es"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Unit
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as DxfUnit)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="in">inches</option>
            </select>
          </label>
          <button
            type="button"
            onClick={downloadDxf}
            className="rounded-md border border-purple-600 bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
          >
            Export DXF
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-zinc-50 p-4 dark:bg-zinc-900">
        <svg
          viewBox={`-2 -2 ${layout.totalW + 4} ${layout.totalH + 4}`}
          xmlns="http://www.w3.org/2000/svg"
          className="h-full w-full"
          style={{ maxHeight: "100%" }}
        >
          {layout.placed.map((p) => {
            const d =
              "M " +
              p.poly
                .map(([x, y]) => `${(x + p.tx).toFixed(2)} ${(y + p.ty).toFixed(2)}`)
                .join(" L ") +
              " Z";
            return (
              <g key={p.name}>
                <path
                  d={d}
                  fill={p.color + "22"}
                  stroke={p.color}
                  strokeWidth={0.2}
                />
                <text
                  x={p.tx + p.minX + p.width / 2}
                  y={p.ty + p.minY + p.height / 2}
                  textAnchor="middle"
                  fontSize={1.6}
                  fill="#111"
                  className="pointer-events-none select-none"
                >
                  {p.name}
                </text>
                <text
                  x={p.tx + p.minX + p.width / 2}
                  y={p.ty + p.minY + p.height / 2 + 2}
                  textAnchor="middle"
                  fontSize={1.1}
                  fill="#555"
                  className="pointer-events-none select-none"
                >
                  {fmtCm(p.width)} × {fmtCm(p.height)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
