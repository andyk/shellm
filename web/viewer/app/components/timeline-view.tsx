// Timeline tab: swimlane view of a mind log. Time runs down; each writer
// gets a lane; runs are summary blocks in the launcher's lane; exact causal
// edges (trigger/dispatch/assoc/merge) are drawn as an SVG overlay. All
// coordinates come precomputed from ~/lib/timeline-model.

import { ArrowDownToLine, Pause } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TimelineDetailModal } from "~/components/timeline-detail";
import { timelineColor } from "~/lib/step-colors";
import {
  GUTTER_W,
  HEADER_H,
  LANE_W,
  laneCenterX,
  rowCenterY,
  type EdgeKind,
  type TimelineBlock,
  type TimelineLayout,
} from "~/lib/timeline-model";
import type { NormalizedStep } from "~/lib/types";
import { cn } from "~/lib/utils";

const EDGE_STROKE: Record<EdgeKind, string> = {
  trigger: "#f59e0b", // amber-500 — step that caused a run
  dispatch: "#38bdf8", // sky-400 — step that woke a thinker
  assoc: "#60a5fa", // blue-400 — run -> step it wrote
  merge: "#e879f9", // fuchsia-400 — fork -> merge write-back
};

const CELL = 12; // square size

function durationOf(started: string, ended: string | null): string | null {
  if (!started || !ended) return null;
  const ms = new Date(ended).getTime() - new Date(started).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function blockTitle(block: TimelineBlock): string {
  if (block.run.tldr) return block.run.tldr;
  const cmd = block.run.command;
  const idx = cmd.lastIndexOf("ACTION:");
  if (idx >= 0) return cmd.slice(idx + 7).replace(/\s+/g, " ").trim();
  const prompt = block.members.find((m) => m.type === "prompt");
  if (prompt?.preview) return prompt.preview;
  return cmd.replace(/\s+/g, " ").trim() || "shellm run";
}

/** Curved edge path between two lane/row anchor points. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.min(60, Math.abs(x2 - x1) / 2);
  const dir = x2 >= x1 ? 1 : -1;
  return `M ${x1} ${y1} C ${x1 + bend * dir} ${y1}, ${x2 - bend * dir} ${y2}, ${x2} ${y2}`;
}

export function TimelineView({
  layout,
  live,
}: {
  layout: TimelineLayout;
  live: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<
    { kind: "step"; step: NormalizedStep } | { kind: "run"; block: TimelineBlock } | null
  >(null);

  const bodyHeight = layout.totalHeight;
  const width = layout.totalWidth;

  // Follow mode: the timeline scrolls inside its own container (so the lane
  // header can stick); while pinned to the bottom, new rows scroll into view.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [bodyHeight, pinned]);

  // Edge endpoints: cells anchor at their square edge; blocks at their top row.
  const edgePaths = useMemo(
    () =>
      layout.edges.map((edge) => {
        const x1 = laneCenterX(edge.from.lane);
        const y1 = rowCenterY(layout, edge.from.row);
        const x2 = laneCenterX(edge.to.lane);
        const y2 = rowCenterY(layout, edge.to.row);
        const inset = LANE_W / 2 - 6;
        const dir = x2 >= x1 ? 1 : -1;
        return {
          edge,
          d: edgePath(x1 + inset * dir, y1, x2 - inset * dir, y2),
        };
      }),
    [layout]
  );

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="overflow-auto rounded-lg border"
        style={{ maxHeight: "calc(100vh - 210px)" }}
      >
        <div className="relative" style={{ width, minWidth: "100%" }}>
          {/* sticky lane headers */}
        <div
          className="sticky top-0 z-20 flex border-b bg-background/95 backdrop-blur"
          style={{ height: HEADER_H, width }}
        >
          <div style={{ width: GUTTER_W }} className="shrink-0" />
          {layout.lanes.map((lane) => (
            <div
              key={lane.id}
              style={{ width: LANE_W }}
              className="flex shrink-0 items-center gap-1.5 border-l px-2"
            >
              <span
                className={cn(
                  "truncate font-mono text-xs",
                  lane.kind === "thinker" ? "font-medium" : "text-muted-foreground"
                )}
              >
                {lane.label}
              </span>
            </div>
          ))}
        </div>

        {/* body */}
        <div className="relative" style={{ height: bodyHeight, width }}>
          {/* lane guide lines */}
          {layout.lanes.map((_, i) => (
            <div
              key={i}
              className="absolute top-0 border-l border-border/50"
              style={{ left: GUTTER_W + i * LANE_W, height: bodyHeight }}
            />
          ))}

          {/* wall-clock gutter */}
          {layout.rowClock.map((label, row) =>
            label ? (
              <div
                key={row}
                className="absolute pr-2 text-right font-mono text-[9px] leading-none text-muted-foreground/70"
                style={{ left: 0, width: GUTTER_W, top: rowCenterY(layout, row) - 4 }}
              >
                {label}
              </div>
            ) : null
          )}

          {/* gap dividers */}
          {layout.gaps.map((gap) => (
            <div
              key={gap.row}
              className="absolute flex items-center gap-2 px-3"
              style={{
                left: GUTTER_W,
                width: width - GUTTER_W,
                top: layout.rowY[gap.row],
                height: layout.rowH[gap.row],
              }}
            >
              <span className="h-px flex-1 border-t border-dashed border-border" />
              <span className="font-mono text-[10px] text-muted-foreground/70">
                {gap.label}
              </span>
              <span className="h-px flex-1 border-t border-dashed border-border" />
            </div>
          ))}

          {/* edges */}
          <svg
            className="pointer-events-none absolute left-0 top-0"
            width={width}
            height={bodyHeight}
          >
            <defs>
              {Object.entries(EDGE_STROKE).map(([kind, color]) => (
                <marker
                  key={kind}
                  id={`arrow-${kind}`}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" fill={color} />
                </marker>
              ))}
            </defs>
            {edgePaths.map(({ edge, d }) => {
              const hot =
                hovered !== null && (edge.fromId === hovered || edge.toId === hovered);
              return (
                <path
                  key={edge.id}
                  d={d}
                  fill="none"
                  stroke={EDGE_STROKE[edge.kind]}
                  strokeWidth={hot ? 2 : 1.25}
                  opacity={hovered === null ? 0.45 : hot ? 0.95 : 0.12}
                  markerEnd={`url(#arrow-${edge.kind})`}
                />
              );
            })}
          </svg>

          {/* run blocks */}
          {layout.blocks.map((block) => {
            const top = layout.rowY[block.startRow] + 2;
            const bottom =
              layout.rowY[block.endRow] + layout.rowH[block.endRow] - 2;
            const running = block.open && live;
            const hot = hovered === block.run.run_id;
            const iters = block.members.filter((m) => m.type === "shell-output").length;
            const duration = durationOf(block.run.started_ts, block.run.ended_ts);
            return (
              <button
                key={block.run.run_id}
                type="button"
                onClick={() => setSelected({ kind: "run", block })}
                onMouseEnter={() => setHovered(block.run.run_id)}
                onMouseLeave={() => setHovered(null)}
                className={cn(
                  // no overflow-hidden: it would become the sticky summary's
                  // scroll container and pin the summary 38px into the block
                  "absolute z-10 flex flex-col rounded-md border px-2 py-1 text-left",
                  "border-blue-300 bg-blue-50/70 hover:bg-blue-100/70",
                  "dark:border-blue-800 dark:bg-blue-950/40 dark:hover:bg-blue-900/40",
                  running && "animate-pulse",
                  hot && "ring-2 ring-blue-400/60"
                )}
                style={{
                  left: GUTTER_W + block.lane * LANE_W + 6,
                  width: LANE_W - 12,
                  top,
                  height: Math.max(bottom - top, 24),
                }}
                title={`[run] ${blockTitle(block)}`}
              >
                {/* sticky so long blocks keep their summary in view mid-scroll */}
                <span
                  className="sticky flex w-full flex-col rounded bg-blue-50/90 dark:bg-blue-950/90"
                  style={{ top: HEADER_H + 4 }}
                >
                  <span className="w-full truncate text-[11px] italic leading-4">
                    {blockTitle(block)}
                  </span>
                  <span className="w-full truncate font-mono text-[9px] leading-4 text-muted-foreground">
                    {block.open && !block.run.ended_ts
                      ? live
                        ? "running"
                        : "incomplete"
                      : duration ?? "done"}
                    {iters > 0 && <> · {iters} iter</>}
                    {block.run.model && <> · {block.run.model.replace(/^claude-/, "")}</>}
                  </span>
                </span>
              </button>
            );
          })}

          {/* step cells */}
          {layout.cells.map((cell) => {
            const y = rowCenterY(layout, cell.row);
            const hot = hovered === cell.step.step_id;
            return (
              <button
                key={cell.step.step_id}
                type="button"
                onClick={() => setSelected({ kind: "step", step: cell.step })}
                onMouseEnter={() => setHovered(cell.step.step_id)}
                onMouseLeave={() => setHovered(null)}
                className="absolute z-10 flex items-center gap-1.5 text-left"
                style={{
                  left: GUTTER_W + cell.lane * LANE_W + (cell.inBlock ? 20 : 6),
                  width: LANE_W - (cell.inBlock ? 26 : 12),
                  top: y - ROW_CLICK_H / 2,
                  height: ROW_CLICK_H,
                }}
                title={`[${cell.step.type}] ${cell.step.preview}`}
              >
                <span
                  className={cn(
                    "shrink-0 rounded-sm",
                    timelineColor(cell.step.type),
                    hot && "ring-2 ring-foreground/40"
                  )}
                  style={{ width: CELL, height: CELL }}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[10px] leading-none",
                    cell.step.type === "idle"
                      ? "text-muted-foreground/50"
                      : "text-muted-foreground"
                  )}
                >
                  {cell.step.preview || cell.step.type}
                </span>
              </button>
            );
          })}
        </div>
        </div>
      </div>

      {live && (
        <div className="absolute bottom-3 right-3 z-30">
          {pinned ? (
            <div className="flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 font-mono text-[11px] text-muted-foreground shadow-md backdrop-blur">
              <ArrowDownToLine className="h-3 w-3 text-green-500" />
              following
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                const el = scrollRef.current;
                if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
              }}
              className="flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 font-mono text-[11px] shadow-md backdrop-blur hover:bg-accent"
            >
              <Pause className="h-3 w-3 text-amber-500" />
              paused · resume
            </button>
          )}
        </div>
      )}

      {selected && (
        <TimelineDetailModal selected={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

const ROW_CLICK_H = 20; // click target taller than the square
