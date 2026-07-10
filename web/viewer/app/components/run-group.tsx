import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { StepCard } from "~/components/step-card";
import { Badge } from "~/components/ui/badge";
import type { NormalizedStep, RunGroup } from "~/lib/types";
import { cn } from "~/lib/utils";

function durationOf(run: RunGroup): string | null {
  if (!run.started_ts || !run.ended_ts) return null;
  const ms = new Date(run.ended_ts).getTime() - new Date(run.started_ts).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Trailing ACTION text of the run command, as a fallback title. */
function commandTail(command: string): string {
  const idx = command.lastIndexOf("ACTION:");
  const tail = idx >= 0 ? command.slice(idx + 7) : command;
  return tail.replace(/\s+/g, " ").trim();
}

export function RunGroupBlock({
  run,
  actionStep,
  steps,
  expandAll,
  live = false,
}: {
  run: RunGroup;
  actionStep: NormalizedStep | null;
  steps: NormalizedStep[];
  expandAll: boolean;
  live?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(expandAll), [expandAll]);

  const title = actionStep
    ? String(actionStep.raw.content ?? "")
    : commandTail(run.command);
  const duration = durationOf(run);

  return (
    <div
      id={`step-${run.run_id}`}
      className="my-1 rounded-md border border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Play className="h-3 w-3 shrink-0 text-blue-500" />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                actionStep ? "italic" : "font-mono text-xs"
              )}
            >
              {title || "shellm run"}
            </span>
          </div>
          {run.tldr && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{run.tldr}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              run.status === "done"
                ? "text-muted-foreground"
                : live
                  ? "text-green-700 dark:text-green-400"
                  : "text-amber-700 dark:text-amber-400"
            )}
          >
            {run.status === "done" ? "done" : live ? "running" : "incomplete"}
          </Badge>
          {duration && <span>{duration}</span>}
          <span>{steps.length} steps</span>
        </div>
      </button>
      {open && (
        <div className="space-y-0.5 border-t border-blue-200/60 px-3 py-1.5 dark:border-blue-900/60">
          {steps.map((step) => (
            <StepCard key={step.step_id} step={step} expandAll={expandAll} />
          ))}
        </div>
      )}
    </div>
  );
}
