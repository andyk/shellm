import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

import { IdentityTabs } from "~/components/identity-tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { LoadingDots } from "~/components/ui/loading-dots";
import { Markdown } from "~/components/ui/markdown";
import {
  fetchIdentityStatus,
  fetchMemories,
  fetchMemory,
  pollWhileLive,
} from "~/lib/api";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "shellm · memories" }];
}

export default function MemoriesPage() {
  const { identityId = "" } = useParams();
  const [selected, setSelected] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["status", identityId],
    queryFn: () => fetchIdentityStatus(identityId),
    refetchInterval: 2000,
  });
  const live = status?.live ?? false;

  const { data: memories, isLoading } = useQuery({
    queryKey: ["memories", identityId],
    queryFn: () => fetchMemories(identityId),
    refetchInterval: pollWhileLive(live),
  });

  const active = selected ?? memories?.[0]?.name ?? null;

  const { data: memory } = useQuery({
    queryKey: ["memory", identityId, active],
    queryFn: () => fetchMemory(identityId, active as string),
    enabled: !!active,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingDots />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4">
      <IdentityTabs identityId={identityId} live={live} active="memories" />
      {!memories || memories.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No memories</EmptyTitle>
            <EmptyDescription>
              This identity's memories/ directory is empty.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex gap-4">
          <aside className="w-72 shrink-0">
            <div className="max-h-[75vh] overflow-y-auto rounded-lg border">
              {memories.map((mem) => (
                <button
                  key={mem.name}
                  type="button"
                  onClick={() => setSelected(mem.name)}
                  className={cn(
                    "block w-full truncate border-b px-3 py-2 text-left font-mono text-[11px] last:border-b-0 hover:bg-accent",
                    mem.name === active && "bg-accent font-medium"
                  )}
                  title={mem.name}
                >
                  {mem.name.replace(/\.md$/, "")}
                </button>
              ))}
            </div>
          </aside>
          <div className="min-w-0 flex-1 rounded-lg border bg-card p-4">
            {memory ? (
              <Markdown className="max-w-none">{memory.content}</Markdown>
            ) : (
              <LoadingDots />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
