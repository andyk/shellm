import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, CircleDot } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { fetchTree } from "~/lib/api";
import type { TreeNode } from "~/lib/types";
import { cn } from "~/lib/utils";

const PAGE = 30;

function NodeRow({
  identityId,
  node,
  currentTrajId,
  depth,
}: {
  identityId: string;
  node: TreeNode;
  currentTrajId: string | null;
  depth: number;
}) {
  const isCurrent = node.traj_id === currentTrajId;
  const [open, setOpen] = useState(depth === 0);
  const [shown, setShown] = useState(PAGE);

  // Lazily fetch children when expanding a node the parent payload didn't include.
  const needsFetch = open && node.child_count > 0 && !node.children;
  const { data: fetched } = useQuery({
    queryKey: ["tree-node", identityId, node.traj_id],
    queryFn: () => fetchTree(identityId, node.traj_id, 1),
    enabled: needsFetch,
  });
  const children = node.children ?? fetched?.children ?? [];

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded py-0.5 pr-1 font-mono text-[11px]",
          isCurrent && "bg-primary/10 font-semibold"
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        {node.child_count > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Link
          to={
            depth === 0
              ? `/i/${encodeURIComponent(identityId)}`
              : `/i/${encodeURIComponent(identityId)}/t/${encodeURIComponent(node.traj_id)}`
          }
          className="flex min-w-0 flex-1 items-center gap-1 hover:underline"
          title={node.tldr ?? node.slug}
        >
          <span className="truncate">
            {depth === 0 ? "root" : node.slug.slice(0, 8)}
          </span>
          {node.has_final ? (
            <Check className="h-2.5 w-2.5 shrink-0 text-green-600 dark:text-green-400" />
          ) : (
            <CircleDot className="h-2.5 w-2.5 shrink-0 text-amber-500" />
          )}
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {node.step_count}
          </span>
          {node.child_count > 0 && (
            <span className="shrink-0 text-muted-foreground/60">
              +{node.child_count}
            </span>
          )}
        </Link>
      </div>
      {open && children.length > 0 && (
        <div>
          {children.slice(0, shown).map((child) => (
            <NodeRow
              key={child.traj_id}
              identityId={identityId}
              node={child}
              currentTrajId={currentTrajId}
              depth={depth + 1}
            />
          ))}
          {children.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="py-0.5 font-mono text-[11px] text-muted-foreground hover:underline"
              style={{ paddingLeft: (depth + 1) * 12 + 16 }}
            >
              …{children.length - shown} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ForkTree({
  identityId,
  currentTrajId,
  live,
}: {
  identityId: string;
  currentTrajId: string | null;
  live: boolean;
}) {
  const { data: root } = useQuery({
    queryKey: ["tree", identityId],
    queryFn: () => fetchTree(identityId, undefined, 2),
    refetchInterval: live ? 5000 : false,
  });

  if (!root) return null;
  if (root.child_count === 0) return null;

  return (
    <div>
      <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Fork tree
      </h3>
      <NodeRow
        identityId={identityId}
        node={root}
        currentTrajId={currentTrajId}
        depth={0}
      />
    </div>
  );
}
