import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useParams } from "react-router";

import { IdentityTabs } from "~/components/identity-tabs";
import { TimelineView } from "~/components/timeline-view";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { LoadingDots } from "~/components/ui/loading-dots";
import { fetchIdentityStatus } from "~/lib/api";
import { useMindlog } from "~/lib/use-mindlog";
import { stepColor } from "~/lib/step-colors";
import { buildTimeline } from "~/lib/timeline-model";
import { TrajContext } from "~/lib/traj-context";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "shellm · timeline" }];
}

// Swatch opacity mirrors the canvas: triggers are always on, the rest rest
// as ghosts until an attached step or run is hovered.
const EDGE_LEGEND = [
  { label: "trigger → run", color: "#f59e0b", opacity: 0.9 },
  { label: "wake → thinker", color: "#38bdf8", opacity: 0.3 },
  { label: "run → wrote", color: "#60a5fa", opacity: 0.3 },
  { label: "fork → merge", color: "#e879f9", opacity: 0.3 },
];

export default function TimelinePage() {
  const { identityId = "" } = useParams();

  const { data: status } = useQuery({
    queryKey: ["status", identityId],
    queryFn: () => fetchIdentityStatus(identityId),
    refetchInterval: 2000,
  });
  const live = status?.live ?? false;

  const { data: mindlog, isLoading } = useMindlog(identityId, live);

  const layout = useMemo(
    () => (mindlog ? buildTimeline(mindlog) : null),
    [mindlog]
  );

  const typesPresent = useMemo(() => {
    const seen = new Set<string>();
    for (const cell of layout?.cells ?? []) seen.add(cell.step.type);
    return [...seen];
  }, [layout]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingDots />
      </div>
    );
  }

  if (!mindlog || !layout) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No mind log</EmptyTitle>
          <EmptyDescription>No trajectory found for {identityId}.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <TrajContext.Provider value={{ identityId, trajId: mindlog.traj_id }}>
      <div className="mx-auto w-full max-w-7xl px-4">
        <IdentityTabs
          identityId={identityId}
          live={live}
          active="timeline"
          name={mindlog.identity.name}
        />
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-sm text-muted-foreground">
            {mindlog.step_count} steps · {mindlog.runs.length} runs
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            {typesPresent.map((type) => (
              <span
                key={type}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[10px]",
                  stepColor(type).chip
                )}
              >
                {type}
              </span>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            {EDGE_LEGEND.map(({ label, color, opacity }) => (
              <span
                key={label}
                className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground"
              >
                <svg width="18" height="8">
                  <line
                    x1="1"
                    y1="4"
                    x2="14"
                    y2="4"
                    stroke={color}
                    strokeWidth="1.5"
                    opacity={opacity}
                  />
                  <circle cx="15.5" cy="4" r="2.5" fill={color} opacity={opacity} />
                </svg>
                {label}
              </span>
            ))}
            <span className="font-mono text-[10px] text-muted-foreground/70">
              · hover a step to trace
            </span>
          </div>
        </div>
        <TimelineView layout={layout} live={live} />
      </div>
    </TrajContext.Provider>
  );
}
