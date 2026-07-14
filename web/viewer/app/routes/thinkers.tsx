import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";

import { IdentityTabs } from "~/components/identity-tabs";
import {
  StartStopButtons,
  useControlsEnabled,
  useThinkerMutation,
} from "~/components/thinker-controls";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { LoadingDots } from "~/components/ui/loading-dots";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  fetchDispatch,
  fetchIdentityStatus,
  fetchLog,
  fetchLogs,
  fetchThinkers,
  pollWhileLive,
} from "~/lib/api";
import type { ThinkerInfo, ThinkerState } from "~/lib/types";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "shellm · thinkers" }];
}

function kb(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATE_STYLES: Record<ThinkerState, string> = {
  stopped: "bg-muted text-muted-foreground",
  idle: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  active: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  running:
    "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
};

function StateBadge({ thinker }: { thinker: ThinkerInfo }) {
  let label: string = thinker.state;
  if (thinker.state === "active") label = `active (${thinker.steps_in_flight})`;
  if (thinker.state === "running" && thinker.pid != null)
    label = `running (PID ${thinker.pid})`;
  return <Badge className={STATE_STYLES[thinker.state]}>{label}</Badge>;
}

function ThinkerRow({
  identityId,
  thinker,
  dispatcherRunning,
}: {
  identityId: string;
  thinker: ThinkerInfo;
  dispatcherRunning: boolean;
}) {
  const controlsEnabled = useControlsEnabled();
  const mutation = useThinkerMutation(identityId);
  const stopped = thinker.state === "stopped";
  return (
    <TableRow>
      <TableCell className="font-mono font-medium">{thinker.name}</TableCell>
      <TableCell>
        <StateBadge thinker={thinker} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {thinker.types.map((type) => (
            <Badge key={type} variant="outline" className="text-[10px]">
              {type}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>
        {thinker.pending.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {thinker.pending.map((type) => (
              <Badge
                key={type}
                className="bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              >
                {type}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="font-mono text-[11px] text-muted-foreground">
        {thinker.log_bytes != null
          ? `${kb(thinker.log_bytes)} · ${relativeTime(thinker.log_mtime)}`
          : "—"}
      </TableCell>
      <TableCell className="text-right">
        {controlsEnabled && (
          <div className="flex justify-end gap-1">
            <StartStopButtons
              identityId={identityId}
              names={[thinker.name]}
              running={!stopped && dispatcherRunning}
            />
            <Button
              variant="ghost"
              size="sm"
              title="Fire this thinker's step once (manual trigger)"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({ action: "step", names: [thinker.name] })
              }
            >
              <Zap className="size-3" />
              step
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function StatusPanel({ identityId }: { identityId: string }) {
  const { data: status } = useQuery({
    queryKey: ["thinkers", identityId],
    queryFn: () => fetchThinkers(identityId),
    refetchInterval: 2000,
  });

  if (!status) {
    return (
      <div className="flex justify-center py-10">
        <LoadingDots />
      </div>
    );
  }

  const dispatcherRunning = status.dispatcher.running;
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <span className="text-sm font-medium">Dispatcher</span>
        {dispatcherRunning ? (
          <Badge className={STATE_STYLES.active}>
            running (PID {status.dispatcher.pid})
          </Badge>
        ) : (
          <Badge className={STATE_STYLES.stopped}>stopped</Badge>
        )}
        <span className="font-mono text-xs text-muted-foreground">
          {status.active_thinkers}/{status.thinkers_total} thinkers active ·{" "}
          {status.steps_in_flight} step(s) in flight
          {status.pending_total > 0 && ` · ${status.pending_total} pending`}
        </span>
        <div className="ml-auto">
          <StartStopButtons
            identityId={identityId}
            names={[]}
            running={dispatcherRunning}
            startDisabled={dispatcherRunning}
            startDisabledReason="Dispatcher already running — start thinkers individually or stop first"
          />
        </div>
      </div>
      {status.thinkers.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">
          No thinkers installed for this identity.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thinker</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Subscribes to</TableHead>
                <TableHead>Pending</TableHead>
                <TableHead>Log</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.thinkers.map((thinker) => (
                <ThinkerRow
                  key={thinker.name}
                  identityId={identityId}
                  thinker={thinker}
                  dispatcherRunning={dispatcherRunning}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
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
      <StatusPanel identityId={identityId} />
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
