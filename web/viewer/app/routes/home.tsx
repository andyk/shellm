import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Skull, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { StartStopButtons, useControlsEnabled } from "~/components/thinker-controls";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { LoadingDots } from "~/components/ui/loading-dots";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  createIdentity,
  exportAllUrl,
  fetchIdentities,
  importIdentities,
  killAll,
} from "~/lib/api";
import type { Identity } from "~/lib/types";

export function meta() {
  return [{ title: "shellm · identities" }];
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const delta = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function LiveBadge({ live }: { live: boolean }) {
  if (!live) return null;
  return (
    <Badge className="gap-1.5 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      live
    </Badge>
  );
}

function DispatcherCell({ identity }: { identity: Identity }) {
  if (identity.dispatcher?.running) {
    return (
      <span className="font-mono text-xs text-green-700 dark:text-green-400">
        ● PID {identity.dispatcher.pid}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">stopped</span>;
}

function NewIdentityForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createIdentity,
    onSuccess: (created) => {
      toast.success(`Created identity ${created.name}`);
      queryClient.invalidateQueries({ queryKey: ["identities"] });
      setOpen(false);
      setName("");
      navigate(`/i/${encodeURIComponent(created.id)}/thinkers`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3" />
        New identity
      </Button>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) mutation.mutate(name.trim());
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="lowercase-name"
        pattern="[a-z0-9][a-z0-9-]*"
        title="lowercase alphanumeric + hyphens"
        className="h-8 w-44 font-mono text-xs"
      />
      <Button type="submit" size="sm" disabled={mutation.isPending || !name.trim()}>
        Create
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </form>
  );
}

function ImportIdentityForm() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ file, name }: { file: File; name?: string }) =>
      importIdentities(file, name),
    onSuccess: (result) => {
      const names = result.imported.map((i) => i.name);
      toast.success(
        names.length === 1
          ? `Imported identity ${names[0]}`
          : `Imported ${names.length} identities: ${names.join(", ")}`
      );
      queryClient.invalidateQueries({ queryKey: ["identities"] });
      setOpen(false);
      setFile(null);
      setName("");
      if (result.imported.length === 1)
        navigate(`/i/${encodeURIComponent(result.imported[0].id)}/thinkers`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        title="Install identities from an `identity export` archive"
        onClick={() => setOpen(true)}
      >
        <Upload className="size-3" />
        Import
      </Button>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (file) mutation.mutate({ file, name: name.trim() || undefined });
      }}
    >
      <input
        ref={fileInput}
        type="file"
        accept=".tgz,.gz,application/gzip"
        className="w-56 text-xs file:mr-2 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1 file:text-xs"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="rename (optional)"
        pattern="[a-z0-9][a-z0-9-]*"
        title="lowercase alphanumeric + hyphens; only for single-identity archives"
        className="h-8 w-40 font-mono text-xs"
      />
      <Button type="submit" size="sm" disabled={mutation.isPending || !file}>
        {mutation.isPending ? "Importing…" : "Import"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </form>
  );
}

function KillAllButton() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: killAll,
    onSuccess: (result) => {
      const summary = result.stdout.trim() || "No shellm processes found.";
      if (result.dry_run) {
        if (window.confirm(`${summary}\n\nProceed with kill?`)) {
          mutation.mutate(false);
          return;
        }
        toast.info("Kill-all cancelled");
      } else {
        toast.success("Kill-all complete", { description: summary });
        queryClient.invalidateQueries();
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={mutation.isPending}
      title="Kill every shellm process on this machine (dispatchers, agents, thinker steps)"
      onClick={() => mutation.mutate(true)}
    >
      <Skull className="size-3" />
      Kill all
    </Button>
  );
}

export default function Home() {
  const controlsEnabled = useControlsEnabled();
  const { data: identities, isLoading } = useQuery({
    queryKey: ["identities"],
    queryFn: fetchIdentities,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingDots />
      </div>
    );
  }

  const groups = new Map<string, Identity[]>();
  for (const identity of identities ?? []) {
    const list = groups.get(identity.group) ?? [];
    list.push(identity);
    groups.set(identity.group, list);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {controlsEnabled && <NewIdentityForm />}
          {controlsEnabled && <ImportIdentityForm />}
        </div>
        <div className="flex items-center gap-2">
          {(identities?.length ?? 0) > 0 && (
            <Button
              variant="outline"
              size="sm"
              asChild
              title="Download every identity under .identities as one .shellm.tgz"
            >
              <a href={exportAllUrl()} download>
                <Download className="size-3" />
                Export all
              </a>
            </Button>
          )}
          {controlsEnabled && <KillAllButton />}
        </div>
      </div>
      {!identities || identities.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No identities found</EmptyTitle>
            <EmptyDescription>
              No directories with an info.txt containing root_trajectory= were
              found under the serve root.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        [...groups.entries()].map(([group, members]) => (
          <section key={group}>
            <h2 className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {group}
            </h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Identity</TableHead>
                    <TableHead>Dispatcher</TableHead>
                    <TableHead>Thinkers</TableHead>
                    <TableHead className="text-right">In flight</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead className="text-right">Steps</TableHead>
                    {controlsEnabled && (
                      <TableHead className="text-right">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((identity) => (
                    <TableRow key={identity.id}>
                      <TableCell>
                        <Link
                          to={`/i/${encodeURIComponent(identity.id)}`}
                          className="flex items-center gap-2 font-mono font-medium hover:underline"
                        >
                          {identity.name}
                          <LiveBadge live={identity.live} />
                        </Link>
                      </TableCell>
                      <TableCell>
                        <DispatcherCell identity={identity} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {identity.thinkers_total > 0
                          ? `${identity.thinkers_active}/${identity.thinkers_total} active`
                          : "—"}
                      </TableCell>
                      <TableCell
                        className={
                          "text-right font-mono tabular-nums" +
                          (identity.steps_in_flight > 0
                            ? " font-semibold text-green-700 dark:text-green-400"
                            : " text-muted-foreground")
                        }
                      >
                        {identity.steps_in_flight}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {relativeTime(identity.last_activity_ts)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {identity.step_count}
                      </TableCell>
                      {controlsEnabled && (
                        <TableCell className="text-right">
                          {identity.thinkers_total > 0 && (
                            <div className="flex justify-end">
                              <StartStopButtons
                                identityId={identity.id}
                                names={[]}
                                running={identity.dispatcher?.running ?? false}
                              />
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
