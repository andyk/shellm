import { useMemo, useState } from "react";

import { timelineColor } from "~/lib/step-colors";
import type { NormalizedStep } from "~/lib/types";

interface Segment {
  step: NormalizedStep;
  widthPct: number;
}

/**
 * Proportional timeline: each segment's width is the time gap to the next
 * step. Hover shows a preview tooltip; click scrolls to the step.
 */
export function TimelineBar({
  steps,
  onStepClick,
}: {
  steps: NormalizedStep[];
  onStepClick: (step: NormalizedStep) => void;
}) {
  const [hover, setHover] = useState<{ step: NormalizedStep; x: number } | null>(null);

  const segments = useMemo<Segment[]>(() => {
    if (steps.length === 0) return [];
    const times = steps.map((s) => new Date(s.ts).getTime());
    const durations = times.map((t, i) =>
      Math.max(i < times.length - 1 ? times[i + 1] - t : 500, 200)
    );
    const total = durations.reduce((a, b) => a + b, 0);
    return steps.map((step, i) => ({
      step,
      widthPct: (durations[i] / total) * 100,
    }));
  }, [steps]);

  if (segments.length === 0) return null;

  return (
    <div className="relative">
      <div className="flex h-5 w-full overflow-hidden rounded">
        {segments.map(({ step, widthPct }) => (
          <button
            key={step.step_id}
            type="button"
            className={`h-full min-w-[2px] border-r border-background/40 transition-opacity hover:opacity-70 ${timelineColor(step.type)}`}
            style={{ width: `${widthPct}%` }}
            onClick={() => onStepClick(step)}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.parentElement!.getBoundingClientRect();
              setHover({ step, x: e.currentTarget.getBoundingClientRect().left - rect.left });
            }}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </div>
      {hover && (
        <div
          className="pointer-events-none absolute top-6 z-20 max-w-md rounded border bg-popover px-2 py-1 font-mono text-[11px] text-popover-foreground shadow-md"
          style={{ left: Math.min(hover.x, 600) }}
        >
          <span className="text-muted-foreground">{hover.step.ts.slice(11, 19)}</span>{" "}
          <span className="font-medium">{hover.step.type}</span>
          {hover.step.source && <span className="text-muted-foreground"> · {hover.step.source}</span>}
          <div className="truncate">{hover.step.preview}</div>
        </div>
      )}
    </div>
  );
}
