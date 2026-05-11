"use client";

import { useMemo, useState } from "react";
import { gcdToDxf, panelToPolyline, type DxfUnit } from "@/lib/gcd-to-dxf";
import type { GcdPattern } from "@/lib/garment-gpt";
import { useActiveModel, useWorkspace } from "@/lib/workspace-store";

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
  const { attachPattern } = useWorkspace();
  const [unit, setUnit] = useState<DxfUnit>("mm");
  const [selected, setSelected] = useState<string | null>(null);
  const pattern = active?.gcd as GcdPattern | undefined;

  const resizePanel = (name: string, newW: number, newH: number) => {
    if (!pattern || !active) return;
    const panel = pattern.pattern.panels[name];
    if (!panel) return;
    const poly = panelToPolyline(panel);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const curW = maxX - minX;
    const curH = maxY - minY;
    if (curW <= 0 || curH <= 0) return;
    const sx = newW / curW;
    const sy = newH / curH;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const next: GcdPattern = JSON.parse(JSON.stringify(pattern));
    const p = next.pattern.panels[name];
    p.vertices = p.vertices.map(([x, y]) => [
      cx + (x - cx) * sx,
      cy + (y - cy) * sy,
    ]);
    attachPattern(active.id, active.gcdUrl ?? "", next);
  };

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
      <div className="flex min-h-0 flex-1">
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
              const isSelected = selected === p.name;
              return (
                <g key={p.name} onClick={() => setSelected(p.name)} style={{ cursor: "pointer" }}>
                  <path
                    d={d}
                    fill={p.color + (isSelected ? "55" : "22")}
                    stroke={p.color}
                    strokeWidth={isSelected ? 0.5 : 0.2}
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
        <aside className="w-64 shrink-0 overflow-auto border-l border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Panel specs (cm)
          </div>
          <ul className="space-y-2 text-xs">
            {layout.placed.map((p) => (
              <PanelRow
                key={p.name}
                name={p.name}
                color={p.color}
                width={p.width}
                height={p.height}
                selected={selected === p.name}
                onSelect={() => setSelected(p.name)}
                onResize={(w, h) => resizePanel(p.name, w, h)}
              />
            ))}
          </ul>
          <p className="mt-3 text-[10px] leading-snug text-zinc-400">
            Edit dimensions to uniformly rescale a panel about its centroid.
            Re-export DXF after changes.
          </p>
        </aside>
      </div>
    </div>
  );
}

function PanelRow({
  name,
  color,
  width,
  height,
  selected,
  onSelect,
  onResize,
}: {
  name: string;
  color: string;
  width: number;
  height: number;
  selected: boolean;
  onSelect: () => void;
  onResize: (w: number, h: number) => void;
}) {
  const [w, setW] = useState(width.toFixed(1));
  const [h, setH] = useState(height.toFixed(1));
  // Reset inputs when the underlying panel changes from outside (e.g. another panel edit re-laid out).
  useMemo(() => {
    setW(width.toFixed(1));
    setH(height.toFixed(1));
  }, [width, height]);
  const apply = () => {
    const nw = parseFloat(w);
    const nh = parseFloat(h);
    if (!Number.isFinite(nw) || !Number.isFinite(nh) || nw <= 0 || nh <= 0) return;
    if (Math.abs(nw - width) < 0.05 && Math.abs(nh - height) < 0.05) return;
    onResize(nw, nh);
  };
  return (
    <li
      onClick={onSelect}
      className={`rounded border px-2 py-1.5 ${
        selected
          ? "border-zinc-400 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-800"
          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      }`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
        <span className="truncate text-zinc-700 dark:text-zinc-200">{name}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          step="0.5"
          value={w}
          onChange={(e) => setW(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => e.key === "Enter" && apply()}
          className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-right text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="text-zinc-400">×</span>
        <input
          type="number"
          step="0.5"
          value={h}
          onChange={(e) => setH(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => e.key === "Enter" && apply()}
          className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-right text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="text-[10px] text-zinc-500">cm</span>
      </div>
    </li>
  );
}
