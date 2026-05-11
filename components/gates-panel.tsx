"use client";

import { useMemo } from "react";
import type { GcdPattern } from "@/lib/garment-gpt";
import { runAllGates, type GatesResult } from "@/lib/gates/run-all";

export function useGates(pattern: GcdPattern | undefined): GatesResult | null {
  return useMemo(() => (pattern ? runAllGates(pattern) : null), [pattern]);
}

export function GatesPanel({ result }: { result: GatesResult | null }) {
  if (!result) return null;
  const items = [
    {
      key: "cuttability",
      label: "Cuttable",
      pass: result.cuttability.pass,
      detail: result.cuttability.failures
        .map((f) => (f.panel ? `${f.panel}: ${f.message}` : f.message))
        .join(" · "),
    },
    {
      key: "yardage",
      label: `Yardage ${result.yardage.consumedYards.toFixed(2)} yd (${result.yardage.efficiencyPct.toFixed(0)}% efficient)`,
      pass: result.yardage.pass,
      detail: result.yardage.failures.map((f) => f.message).join(" · "),
    },
    {
      key: "stitch",
      label: `Stitches ${result.stitch.checkedStitches}`,
      pass: result.stitch.pass,
      detail: result.stitch.failures.map((f) => f.message).join(" · "),
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Gates
      </span>
      {items.map((it) => (
        <span
          key={it.key}
          title={it.detail || (it.pass ? "ok" : "")}
          className={
            "rounded-md px-2 py-0.5 font-medium " +
            (it.pass
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300")
          }
        >
          {it.pass ? "✓" : "✗"} {it.label}
        </span>
      ))}
    </div>
  );
}
