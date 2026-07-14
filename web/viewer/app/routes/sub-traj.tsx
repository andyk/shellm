import { useQuery } from "@tanstack/react-query";
import { FoldVertical, UnfoldVertical } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { ForkTree } from "~/components/fork-tree";
import { assembleStream, StreamItems } from "~/components/stream";
import { TimelineBar } from "~/components/timeline-bar";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { LoadingDots } from "~/components/ui/loading-dots";
import { fetchIdentityStatus, fetchSubTraj, pollWhileLive } from "~/lib/api";
import { LiveBadge } from "~/components/live-badge";
import { TrajContext } from "~/lib/traj-context";
import { scrollToStep } from "~/routes/identity";

export function meta() {
  return [{ title: "shellm · sub-trajectory" }];
}

export default function SubTrajPage() {
  const { identityId = "", trajId = "" } = useParams();
  const [expandAll, setExpandAll] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["status", identityId],
    queryFn: () => fetchIdentityStatus(identityId),
    refetchInterval: 2000,
  });
  const live = status?.live ?? false;

  const { data: traj, isLoading } = useQuery({
    queryKey: ["traj", identityId, trajId],
    queryFn: () => fetchSubTraj(identityId, trajId),
    refetchInterval: pollWhileLive(live),
  });

  const stream = useMemo(
    () => (traj ? assembleStream(traj.steps, traj.runs) : []),
    [traj]
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingDots />
      </div>
    );
  }

  if (!traj) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Trajectory not found</EmptyTitle>
          <EmptyDescription>
            No trajectory {trajId} under {identityId}.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <TrajContext.Provider value={{ identityId, trajId: traj.traj_id }}>
      <div className="mx-auto w-full max-w-7xl px-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Link to="/" className="text-sm text-muted-foreground hover:underline">
            identities
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link
            to={`/i/${encodeURIComponent(identityId)}/mindlog`}
            className="font-mono text-sm hover:underline"
          >
            {traj.identity.name}
          </Link>
          {traj.breadcrumb.slice(1).map((crumb) => (
            <Fragment key={crumb.traj_id}>
              <span className="text-muted-foreground">/</span>
              {crumb.traj_id === traj.traj_id ? (
                <span className="font-mono text-sm font-semibold">
                  {crumb.slug.slice(0, 8)}
                </span>
              ) : (
                <Link
                  to={`/i/${encodeURIComponent(identityId)}/t/${encodeURIComponent(crumb.traj_id)}`}
                  className="font-mono text-sm hover:underline"
                  title={crumb.slug}
                >
                  {crumb.slug.slice(0, 8)}
                </Link>
              )}
            </Fragment>
          ))}
          {live && <LiveBadge />}
          <span className="text-sm text-muted-foreground">
            {traj.step_count} steps
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

        <div className="mb-1 truncate font-mono text-[11px] text-muted-foreground">
          {traj.dir_rel}
        </div>

        <div className="mb-4">
          <TimelineBar steps={traj.steps} onStepClick={scrollToStep} />
        </div>

        <div className="flex gap-4">
          <aside className="hidden w-52 shrink-0 md:block">
            <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pb-4">
              <ForkTree
                identityId={identityId}
                currentTrajId={traj.traj_id}
                live={live}
              />
            </div>
          </aside>
          <div className="min-w-0 flex-1 rounded-lg border bg-card px-2 py-2">
            <StreamItems items={stream} expandAll={expandAll} live={live} />
          </div>
        </div>
      </div>
    </TrajContext.Provider>
  );
}
