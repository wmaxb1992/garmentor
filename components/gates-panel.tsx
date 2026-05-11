"use client";

import { useMemo } from "react";
import type { GcdPattern } from "@/lib/garment-gpt";
import { runAllGates, type GatesResult } from "@/lib/gates/run-all";
import { applyDeltas } from "@/lib/agents/modifier";

export function useGates(pattern: GcdPattern | undefined): GatesResult | null {
  return useMemo(() => (pattern ? runAllGates(pattern) : null), [pattern]);
}

export function GatesPanel({
  result,
  onApplyFix,
}: {
  result: GatesResult | null;
  onApplyFix?: (next: GcdPattern, summary: string) => void;
}) {
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
      {result.proposedDeltas.length > 0 && onApplyFix && (
        <button
          type="button"
          onClick={() => {
            // Caller has the source pattern; we pass back instructions.
            const summary = result.proposedDeltas
              .map(
                (d) =>
                  `${d.panel ?? "all"}${d.length_cm ? ` length${d.length_cm > 0 ? "+" : ""}${d.length_cm.toFixed(1)}` : ""}${d.width_cm ? ` width${d.width_cm > 0 ? "+" : ""}${d.width_cm.toFixed(1)}` : ""}${d.chest_cm ? ` chest${d.chest_cm > 0 ? "+" : ""}${d.chest_cm.toFixed(1)}` : ""}`,
              )
              .join(" · ");
            // Caller computes the fixed pattern using its own GCD reference.
            onApplyFix({} as GcdPattern, summary);
          }}
          className="ml-auto rounded-md border border-amber-500 bg-amber-500 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-amber-600"
          title={result.proposedDeltas
            .map((d) => JSON.stringify(d))
            .join("\n")}
        >
          Apply suggested fixes ({result.proposedDeltas.length})
        </button>
      )}
    </div>
  );
}

export function applyGateFixes(pattern: GcdPattern, gates: GatesResult): GcdPattern {
  return applyDeltas(pattern, gates.proposedDeltas);
}
