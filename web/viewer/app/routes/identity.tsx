import { useQuery } from "@tanstack/react-query";
import { FoldVertical, UnfoldVertical } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { FollowPin } from "~/components/follow-pin";
import { ForkTree } from "~/components/fork-tree";
import { IdentityTabs } from "~/components/identity-tabs";
import { assembleStream, StreamItems } from "~/components/stream";
import { TimelineBar } from "~/components/timeline-bar";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { LoadingDots } from "~/components/ui/loading-dots";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { fetchIdentityStatus, fetchMindlog, pollWhileLive } from "~/lib/api";
import { TrajContext } from "~/lib/traj-context";
import type { NormalizedStep } from "~/lib/types";

export function meta() {
  return [{ title: "shellm · mind log" }];
}

export function scrollToStep(step: NormalizedStep) {
  const el =
    document.getElementById(`step-${step.step_id}`) ??
    (step.run_id ? document.getElementById(`step-${step.run_id}`) : null);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (el) {
    el.classList.add("bg-primary/10");
    setTimeout(() => el.classList.remove("bg-primary/10"), 1500);
  }
}

export default function IdentityPage() {
  const { identityId = "" } = useParams();
  const [hideParam, setHideParam] = useQueryState("hide", parseAsString.withDefault(""));
  const [sourceFilter, setSourceFilter] = useQueryState(
    "source",
    parseAsString.withDefault("all")
  );
  const [expandAll, setExpandAll] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["status", identityId],
    queryFn: () => fetchIdentityStatus(identityId),
    refetchInterval: 2000,
  });
  const live = status?.live ?? false;

  const { data: mindlog, isLoading } = useQuery({
    queryKey: ["mindlog", identityId],
    queryFn: () => fetchMindlog(identityId),
    refetchInterval: pollWhileLive(live),
  });

  const hidden = useMemo(
    () => new Set(hideParam.split(",").filter(Boolean)),
    [hideParam]
  );

  const stream = useMemo(
    () => (mindlog ? assembleStream(mindlog.steps, mindlog.runs) : []),
    [mindlog]
  );

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const step of mindlog?.steps ?? []) {
      counts.set(step.type, (counts.get(step.type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [mindlog]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const step of mindlog?.steps ?? []) {
      if (step.source) set.add(step.source);
    }
    return [...set].sort();
  }, [mindlog]);

  const visible = useMemo(() => {
    const sourceOk = (step: NormalizedStep) =>
      sourceFilter === "all" || step.source === sourceFilter;
    return stream.filter((item) => {
      if (item.kind === "run") return !hidden.has("shellm-run");
      if (item.kind === "idle")
        return !hidden.has("idle") && (sourceFilter === "all" || item.steps.some(sourceOk));
      return !hidden.has(item.step.type) && sourceOk(item.step);
    });
  }, [stream, hidden, sourceFilter]);

  const toggleType = (type: string) => {
    const next = new Set(hidden);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setHideParam([...next].join(",") || null);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingDots />
      </div>
    );
  }

  if (!mindlog) {
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
          active="mindlog"
          name={mindlog.identity.name}
        />
        <div className="mb-3 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {mindlog.step_count} steps · {mindlog.runs.length} runs
          </span>
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpandAll((v) => !v)}
              className="gap-1.5 text-xs"
            >
              {expandAll ? (
                <>
                  <FoldVertical className="h-3.5 w-3.5" /> Collapse all
                </>
              ) : (
                <>
                  <UnfoldVertical className="h-3.5 w-3.5" /> Expand all
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="mb-4">
          <TimelineBar steps={mindlog.steps} onStepClick={scrollToStep} />
        </div>

        <div className="flex gap-4">
          <aside className="hidden w-52 shrink-0 md:block">
            <div className="sticky top-16 max-h-[calc(100vh-5rem)] space-y-4 overflow-y-auto pb-4">
              <div>
                <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Step types
                </h3>
                <div className="space-y-1">
                  {typeCounts.map(([type, count]) => (
                    <label
                      key={type}
                      className="flex cursor-pointer items-center gap-2 font-mono text-xs"
                    >
                      <Checkbox
                        checked={!hidden.has(type)}
                        onCheckedChange={() => toggleType(type)}
                      />
                      <span className="min-w-0 flex-1 truncate">{type}</span>
                      <span className="tabular-nums text-muted-foreground">{count}</span>
                    </label>
                  ))}
                </div>
              </div>
              {sources.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Source
                  </h3>
                  <Select
                    value={sourceFilter}
                    onValueChange={(v) => setSourceFilter(v === "all" ? null : v)}
                  >
                    <SelectTrigger className="h-8 w-full font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">all sources</SelectItem>
                      {sources.map((source) => (
                        <SelectItem key={source} value={source} className="font-mono text-xs">
                          {source}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <ForkTree
                identityId={identityId}
                currentTrajId={mindlog.traj_id}
                live={live}
              />
            </div>
          </aside>

          <div className="min-w-0 flex-1 rounded-lg border bg-card px-2 py-2">
            <StreamItems items={visible} expandAll={expandAll} live={live} />
          </div>
        </div>
        <FollowPin live={live} stepCount={mindlog.step_count} />
      </div>
    </TrajContext.Provider>
  );
}
