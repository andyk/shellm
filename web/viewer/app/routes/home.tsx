import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { Badge } from "~/components/ui/badge";
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
import { fetchIdentities } from "~/lib/api";
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

export default function Home() {
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

  if (!identities || identities.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No identities found</EmptyTitle>
          <EmptyDescription>
            No directories with an info.txt containing root_trajectory= were
            found under the serve root.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const groups = new Map<string, Identity[]>();
  for (const identity of identities) {
    const list = groups.get(identity.group) ?? [];
    list.push(identity);
    groups.set(identity.group, list);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4">
      {[...groups.entries()].map(([group, members]) => (
        <section key={group}>
          <h2 className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {group}
          </h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identity</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className="text-right">Steps</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((identity) => (
                  <TableRow key={identity.id} className="cursor-pointer">
                    <TableCell>
                      <Link
                        to={`/i/${encodeURIComponent(identity.id)}`}
                        className="flex items-center gap-2 font-mono font-medium hover:underline"
                      >
                        {identity.name}
                        <LiveBadge live={identity.live} />
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {identity.created ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {relativeTime(identity.last_activity_ts)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {identity.step_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
    </div>
  );
}
