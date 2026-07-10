// Detail modal for the Timeline tab: a clicked step square shows its full
// step card; a clicked run block shows the run summary plus its machinery
// steps. A modal (not inline expansion) so the live timeline never reflows.

import { X } from "lucide-react";
import { useEffect } from "react";

import { ExpandableText } from "~/components/expandable-text";
import { StepCard } from "~/components/step-card";
import { Badge } from "~/components/ui/badge";
import type { TimelineBlock } from "~/lib/timeline-model";
import type { NormalizedStep } from "~/lib/types";

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

export function TimelineDetailModal({
  selected,
  onClose,
}: {
  selected: TimelineSelection;
  onClose: () => void;
}) {
  if (selected.kind === "step") {
    return (
      <Modal onClose={onClose}>
        <div className="pr-8">
          <StepCard step={selected.step} expandAll />
        </div>
      </Modal>
    );
  }

  const { block } = selected;
  const { run } = block;
  const duration = durationOf(run.started_ts, run.ended_ts);
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
        <div className="mb-3 text-muted-foreground">
          <ExpandableText text={run.command} expandAll={false} mono />
        </div>
        <div className="space-y-0.5 border-t pt-2">
          {block.members.map((step) => (
            <StepCard key={step.step_id} step={step} expandAll={false} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
