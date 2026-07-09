import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

import { IdentityTabs } from "~/components/identity-tabs";
import { Badge } from "~/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { LoadingDots } from "~/components/ui/loading-dots";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  fetchDispatch,
  fetchIdentityStatus,
  fetchLog,
  fetchLogs,
  pollWhileLive,
} from "~/lib/api";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "shellm · thinkers" }];
}

function kb(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function LogView({
  identityId,
  name,
  live,
}: {
  identityId: string;
  name: string;
  live: boolean;
}) {
  const [tailBytes, setTailBytes] = useState(65536);
  const { data: log } = useQuery({
    queryKey: ["log", identityId, name, tailBytes],
    queryFn: () => fetchLog(identityId, name, tailBytes),
    refetchInterval: pollWhileLive(live),
  });

  if (!log) {
    return (
      <div className="flex justify-center py-10">
        <LoadingDots />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
        <span>{kb(log.total_bytes)} total</span>
        {log.truncated && (
          <button
            type="button"
            onClick={() => setTailBytes((n) => n * 4)}
            className="hover:underline"
          >
            showing last {kb(tailBytes)} — load more
          </button>
        )}
      </div>
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-card p-3 font-mono text-[11px]">
        {log.content || "(empty)"}
      </pre>
    </div>
  );
}

function DispatchView({
  identityId,
  live,
}: {
  identityId: string;
  live: boolean;
}) {
  const { data: events } = useQuery({
    queryKey: ["dispatch", identityId],
    queryFn: () => fetchDispatch(identityId),
    refetchInterval: pollWhileLive(live),
  });

  if (!events) {
    return (
      <div className="flex justify-center py-10">
        <LoadingDots />
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        No dispatcher.log found.
      </div>
    );
  }

  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
      {events.map((event, idx) => (
        <div
          key={idx}
          className={cn(
            "flex items-center gap-2 border-b px-3 py-1 font-mono text-[11px] last:border-b-0",
            event.kind === "dispatch" && "bg-blue-50/50 dark:bg-blue-950/20"
          )}
        >
          {event.kind === "step" && (
            <>
              <span className="text-muted-foreground">step</span>
              <Badge variant="outline" className="text-[10px]">
                {event.type}
              </Badge>
              {event.source && (
                <span className="text-muted-foreground">from {event.source}</span>
              )}
            </>
          )}
          {event.kind === "dispatch" && (
            <>
              <span className="font-medium text-blue-700 dark:text-blue-300">
                dispatch → {event.thinker}
              </span>
              {event.active != null && (
                <span className="text-muted-foreground">active={event.active}</span>
              )}
            </>
          )}
          {event.kind === "other" && (
            <span className="text-muted-foreground">{event.raw}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ThinkersPage() {
  const { identityId = "" } = useParams();

  const { data: status } = useQuery({
    queryKey: ["status", identityId],
    queryFn: () => fetchIdentityStatus(identityId),
    refetchInterval: 2000,
  });
  const live = status?.live ?? false;

  const { data: logs, isLoading } = useQuery({
    queryKey: ["logs", identityId],
    queryFn: () => fetchLogs(identityId),
    refetchInterval: pollWhileLive(live),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingDots />
      </div>
    );
  }

  const logNames = (logs ?? [])
    .map((l) => l.name)
    .filter((name) => name !== "dispatcher.log");

  return (
    <div className="mx-auto w-full max-w-6xl px-4">
      <IdentityTabs identityId={identityId} live={live} active="thinkers" />
      {!logs || logs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No thinker logs</EmptyTitle>
            <EmptyDescription>
              No run/logs/*.log files found for this identity.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Tabs defaultValue="dispatch">
          <TabsList>
            <TabsTrigger value="dispatch" className="font-mono text-xs">
              dispatch
            </TabsTrigger>
            {logNames.map((name) => (
              <TabsTrigger key={name} value={name} className="font-mono text-xs">
                {name.replace(/\.log$/, "")}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="dispatch">
            <DispatchView identityId={identityId} live={live} />
          </TabsContent>
          {logNames.map((name) => (
            <TabsContent key={name} value={name}>
              <LogView identityId={identityId} name={name} live={live} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
