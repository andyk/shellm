import { useState } from "react";

import { RunGroupBlock } from "~/components/run-group";
import { StepCard } from "~/components/step-card";
import type { NormalizedStep, RunGroup } from "~/lib/types";

export type StreamItem =
  | { kind: "step"; step: NormalizedStep }
  | {
      kind: "run";
      run: RunGroup;
      steps: NormalizedStep[];
      actionStep: NormalizedStep | null;
    }
  | { kind: "idle"; steps: NormalizedStep[] };

/**
 * Turn the flat step list into renderable items: inline runs become
 * collapsible blocks anchored at their shellm-run step, consecutive idles
 * fold into strips, and actions joined to a run render as that run's header.
 */
export function assembleStream(
  steps: NormalizedStep[],
  runs: RunGroup[]
): StreamItem[] {
  const runsById = new Map(runs.map((run) => [run.run_id, run]));
  const actionsById = new Map<string, NormalizedStep>();
  for (const run of runs) {
    if (run.action_step_id) {
      const action = steps.find((s) => s.step_id === run.action_step_id);
      if (action) actionsById.set(run.action_step_id, action);
    }
  }

  const items: StreamItem[] = [];
  const runItems = new Map<string, Extract<StreamItem, { kind: "run" }>>();

  for (const step of steps) {
    if (step.run_id && runsById.has(step.run_id)) {
      let runItem = runItems.get(step.run_id);
      if (!runItem) {
        const run = runsById.get(step.run_id)!;
        runItem = {
          kind: "run",
          run,
          steps: [],
          actionStep: run.action_step_id
            ? actionsById.get(run.action_step_id) ?? null
            : null,
        };
        runItems.set(step.run_id, runItem);
        items.push(runItem);
      }
      runItem.steps.push(step);
      continue;
    }
    if (actionsById.has(step.step_id)) continue; // rendered as its run's header
    if (step.type === "idle") {
      const last = items[items.length - 1];
      if (last?.kind === "idle") {
        last.steps.push(step);
      } else {
        items.push({ kind: "idle", steps: [step] });
      }
      continue;
    }
    items.push({ kind: "step", step });
  }
  return items;
}

export function IdleStrip({
  steps,
  expandAll,
}: {
  steps: NormalizedStep[];
  expandAll: boolean;
}) {
  const [show, setShow] = useState(false);
  const first = steps[0].ts.slice(11, 19);
  const last = steps[steps.length - 1].ts.slice(11, 19);
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="flex w-full items-center gap-2 py-0.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground"
      >
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono">
          idle ×{steps.length} ({first}–{last}) {show ? "hide" : "show"}
        </span>
        <span className="h-px flex-1 bg-border" />
      </button>
      {show &&
        steps.map((step) => (
          <StepCard key={step.step_id} step={step} expandAll={expandAll} />
        ))}
    </div>
  );
}

export function StreamItems({
  items,
  expandAll,
  live = false,
}: {
  items: StreamItem[];
  expandAll: boolean;
  live?: boolean;
}) {
  return (
    <>
      {items.map((item) => {
        if (item.kind === "run") {
          return (
            <RunGroupBlock
              key={item.run.run_id}
              run={item.run}
              actionStep={item.actionStep}
              steps={item.steps}
              expandAll={expandAll}
              live={live}
            />
          );
        }
        if (item.kind === "idle") {
          return (
            <IdleStrip
              key={item.steps[0].step_id}
              steps={item.steps}
              expandAll={expandAll}
            />
          );
        }
        return (
          <StepCard key={item.step.step_id} step={item.step} expandAll={expandAll} />
        );
      })}
    </>
  );
}
