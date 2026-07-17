import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import { IdentityTabs } from "~/components/identity-tabs";
import { useControlsEnabled } from "~/components/thinker-controls";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { LoadingDots } from "~/components/ui/loading-dots";
import { fetchIdentityStatus, fetchRecap, refreshRecap } from "~/lib/api";
import type { RecapStepRef } from "~/lib/types";

export function meta() {
  return [{ title: "shellm · recap" }];
}

/** A step reference that deep-links into the mind log (scroll + highlight). */
function StepRef({
  identityId,
  refItem,
}: {
  identityId: string;
  refItem: RecapStepRef;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <Link
        to={`/i/${encodeURIComponent(identityId)}/mindlog?step=${encodeURIComponent(refItem.step)}`}
        className="rounded bg-muted px-1 font-mono text-[11px] text-primary hover:underline"
        title="Open in mind log"
      >
        {refItem.step}
      </Link>
      <span className="text-xs text-muted-foreground">{refItem.note}</span>
    </span>
  );
}

function RefreshButton({ identityId, refreshing }: { identityId: string; refreshing: boolean }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (rebuild: boolean) => refreshRecap(identityId, rebuild),
    onSuccess: () => {
      toast.success("Recap refresh started — new steps get summarized in the background");
      queryClient.invalidateQueries({ queryKey: ["recap", identityId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={refreshing || mutation.isPending}
      title="Summarize steps added since the last recap (shift-click: rebuild from scratch)"
      onClick={(event) => mutation.mutate(event.shiftKey)}
    >
      <RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} />
      {refreshing ? "Recapping…" : "Refresh"}
    </Button>
  );
}

export default function RecapPage() {
  const { identityId = "" } = useParams();
  const controlsEnabled = useControlsEnabled();

  const { data: status } = useQuery({
    queryKey: ["status", identityId],
    queryFn: () => fetchIdentityStatus(identityId),
    refetchInterval: 5000,
  });

  const { data: recap, isLoading } = useQuery({
    queryKey: ["recap", identityId],
    queryFn: () => fetchRecap(identityId),
    refetchInterval: 5000,
  });

  if (isLoading || !recap) {
    return (
      <div className="flex justify-center py-20">
        <LoadingDots />
      </div>
    );
  }

  const header = (
    <IdentityTabs
      identityId={identityId}
      live={status?.live ?? false}
      active="recap"
      name={recap.identity?.name}
    />
  );

  if (!recap.available) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4">
        {header}
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No recap yet</EmptyTitle>
            <EmptyDescription>
              {recap.refreshing
                ? "A recap is being generated right now — this page refreshes itself."
                : "Generate an LLM summary of this mind log: themes and episodes, each pointing at the steps behind them."}
            </EmptyDescription>
          </EmptyHeader>
          {controlsEnabled && !recap.refreshing && (
            <RefreshButton identityId={identityId} refreshing={false} />
          )}
          {recap.refreshing && (
            <div className="mt-4 flex justify-center">
              <LoadingDots />
            </div>
          )}
        </Empty>
      </div>
    );
  }

  const themes = recap.themes!;
  const episodes = recap.episodes ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4">
      {header}
      <div className="mx-auto w-full max-w-4xl space-y-8 pb-10">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {episodes.length} episodes · generated {themes.generated_at} ·{" "}
            <span className="font-mono">{themes.model}</span>
          </span>
          {(recap.new_steps ?? 0) > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {recap.new_steps} steps since
            </Badge>
          )}
          {controlsEnabled && (
            <div className="ml-auto">
              <RefreshButton identityId={identityId} refreshing={recap.refreshing} />
            </div>
          )}
        </div>

        <section>
          <h2 className="mb-2 flex items-center gap-1.5 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3" /> arc
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed">{themes.arc}</p>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            themes
          </h2>
          <div className="space-y-3">
            {themes.themes.map((theme, index) => (
              <div key={index} className="rounded-lg border p-3">
                <div className="mb-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{theme.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    episodes {theme.episodes.join(", ")}
                  </span>
                </div>
                <p className="mb-2 text-sm text-muted-foreground">{theme.description}</p>
                <div className="flex flex-col gap-1">
                  {theme.key_steps?.map((refItem) => (
                    <StepRef key={refItem.step} identityId={identityId} refItem={refItem} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            episodes
          </h2>
          <div className="space-y-3">
            {episodes.map((episode) => (
              <div key={episode.idx} className="rounded-lg border p-3">
                <div className="mb-1 flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {episode.idx}.
                  </span>
                  <span className="text-sm font-medium">{episode.title}</span>
                  {episode.partial && (
                    <Badge variant="outline" className="text-[10px]">
                      partial
                    </Badge>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {episode.first_ts} → {episode.last_ts} · {episode.n_steps} steps
                  </span>
                </div>
                <p className="mb-2 text-sm">{episode.summary}</p>
                <div className="flex flex-col gap-1">
                  {episode.notable_steps?.map((refItem) => (
                    <StepRef key={refItem.step} identityId={identityId} refItem={refItem} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
