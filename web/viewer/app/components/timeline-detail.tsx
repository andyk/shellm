// Detail modal for the Timeline tab: a clicked step square shows its full
// step card; a clicked run block shows the run summary plus its machinery
// steps. Both are enriched with causal context — what triggered this, what
// run it belongs to, what the run produced — and those rows navigate to the
// related item's modal. A modal (not inline expansion) so the live timeline
// never reflows.

import { ChevronDown, ChevronRight, CornerDownRight, Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import { ExpandableText } from "~/components/expandable-text";
import { StepCard } from "~/components/step-card";
import { Badge } from "~/components/ui/badge";
import { stepColor } from "~/lib/step-colors";
import type { TimelineBlock } from "~/lib/timeline-model";
import type { NormalizedStep } from "~/lib/types";
import { cn } from "~/lib/utils";

export type TimelineSelection =
  | { kind: "step"; step: NormalizedStep }
  | { kind: "run"; block: TimelineBlock };

function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

function durationOf(started: string, ended: string | null): string | null {
  if (!started || !ended) return null;
  const ms = new Date(ended).getTime() - new Date(started).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function runTitle(block: TimelineBlock): string {
  if (block.run.tldr) return block.run.tldr;
  const cmd = block.run.command;
  const idx = cmd.lastIndexOf("ACTION:");
  if (idx >= 0) return cmd.slice(idx + 7).replace(/\s+/g, " ").trim();
  const prompt = block.members.find((m) => m.type === "prompt");
  return prompt?.preview ?? "shellm run";
}

/** Clickable "related item" row: triggered-by, belongs-to-run, etc. */
function RelatedStepRow({
  label,
  step,
  onClick,
}: {
  label: string;
  step: NormalizedStep;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-2 rounded border border-transparent px-1.5 py-1 text-left hover:border-border hover:bg-accent/50"
    >
      <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]",
          stepColor(step.type).chip
        )}
      >
        {step.type}
      </span>
      {step.source && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {step.source}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs">{step.preview}</span>
    </button>
  );
}

function RelatedRunRow({
  label,
  block,
  onClick,
}: {
  label: string;
  block: TimelineBlock;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-2 rounded border border-transparent px-1.5 py-1 text-left hover:border-border hover:bg-accent/50"
    >
      <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{label}</span>
      <Play className="h-3 w-3 shrink-0 text-blue-500" />
      {block.run.launched_by && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {block.run.launched_by}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs italic">{runTitle(block)}</span>
    </button>
  );
}

export function TimelineDetailModal({
  selected,
  onClose,
  onSelect,
  stepById,
  blockByRun,
}: {
  selected: TimelineSelection;
  onClose: () => void;
  onSelect: (next: TimelineSelection) => void;
  stepById: Map<string, NormalizedStep>;
  blockByRun: Map<string, TimelineBlock>;
}) {
  if (selected.kind === "step") {
    const { step } = selected;
    const triggerId =
      typeof step.raw.trigger_step === "string" ? step.raw.trigger_step : null;
    const trigger = triggerId ? stepById.get(triggerId) : undefined;
    const runId = typeof step.raw.run_id === "string" ? step.raw.run_id : null;
    const runBlock = runId ? blockByRun.get(runId) : undefined;
    // this step may itself have triggered runs
    const triggeredRuns = [...blockByRun.values()].filter(
      (b) => b.run.trigger_step_id === step.step_id
    );
    const hasContext = trigger || runBlock || triggeredRuns.length > 0;
    return (
      <Modal onClose={onClose}>
        <div className="pr-8">
          <StepCard step={step} expandAll />
          {hasContext && (
            <div className="mt-3 space-y-0.5 border-t pt-2">
              {trigger && (
                <RelatedStepRow
                  label="triggered by"
                  step={trigger}
                  onClick={() => onSelect({ kind: "step", step: trigger })}
                />
              )}
              {runBlock && (
                <RelatedRunRow
                  label="written inside"
                  block={runBlock}
                  onClick={() => onSelect({ kind: "run", block: runBlock })}
                />
              )}
              {triggeredRuns.map((b) => (
                <RelatedRunRow
                  key={b.run.run_id}
                  label="triggered run"
                  block={b}
                  onClick={() => onSelect({ kind: "run", block: b })}
                />
              ))}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return <RunModal selected={selected} onClose={onClose} onSelect={onSelect} stepById={stepById} />;
}

function RunModal({
  selected,
  onClose,
  onSelect,
  stepById,
}: {
  selected: Extract<TimelineSelection, { kind: "run" }>;
  onClose: () => void;
  onSelect: (next: TimelineSelection) => void;
  stepById: Map<string, NormalizedStep>;
}) {
  // High level (tldr / trigger / result) up top; machinery on demand.
  const [showSteps, setShowSteps] = useState(false);
  const { block } = selected;
  const { run } = block;
  const duration = durationOf(run.started_ts, run.ended_ts);
  const trigger = run.trigger_step_id ? stepById.get(run.trigger_step_id) : undefined;
  const final = block.members.find((m) => m.type === "final");
  const result = typeof final?.raw.content === "string" ? final.raw.content : null;
  return (
    <Modal onClose={onClose}>
      <div className="pr-8">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            run
          </Badge>
          {run.launched_by && (
            <span className="font-mono text-xs text-muted-foreground">
              launched by <span className="text-foreground">{run.launched_by}</span>
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{run.status}</span>
            {duration && <span>{duration}</span>}
            {run.model && <span>{run.model}</span>}
          </span>
        </div>
        {run.tldr && <p className="mb-1 text-sm italic">{run.tldr}</p>}
        <div className="mb-2 text-muted-foreground">
          <ExpandableText text={run.command} expandAll={false} mono />
        </div>
        {(trigger || result) && (
          <div className="mb-2 space-y-1 border-t pt-2">
            {trigger && (
              <RelatedStepRow
                label="triggered by"
                step={trigger}
                onClick={() => onSelect({ kind: "step", step: trigger })}
              />
            )}
            {result && (
              <div className="rounded border bg-muted/30 px-2 py-1.5">
                <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  result
                </div>
                <ExpandableText text={result} expandAll={false} />
              </div>
            )}
          </div>
        )}
        <div className="border-t pt-1.5">
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            aria-expanded={showSteps}
            className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left font-mono text-[11px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            {showSteps ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            steps ({block.members.length})
          </button>
          {showSteps && (
            <div className="mt-1 space-y-0.5">
              {block.members.map((step) => (
                <StepCard key={step.step_id} step={step} expandAll={false} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
