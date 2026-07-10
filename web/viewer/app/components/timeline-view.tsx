// Timeline tab: swimlane view of a mind log. Time runs down; each writer
// gets a lane; runs are summary blocks in the launcher's lane; exact causal
// edges (trigger/dispatch/assoc/merge) are drawn as an SVG overlay. Row
// geometry comes precomputed from ~/lib/timeline-model; lane x-geometry is
// computed here because lanes are collapsible.

import { ArrowDownToLine, ChevronsLeftRight, ChevronsRightLeft, Pause } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useMemo, useRef, useState } from "react";

import { TimelineDetailModal } from "~/components/timeline-detail";
import { timelineColor } from "~/lib/step-colors";
import {
  GUTTER_W,
  HEADER_H,
  LANE_W,
  rowCenterY,
  type EdgeKind,
  type TimelineBlock,
  type TimelineCell,
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
const ROW_CLICK_H = 20; // click target taller than the square
const COLLAPSED_W = 40;
const CELL_PAD = 8; // lane-edge padding for cells/blocks
const NEST_PAD = 26; // extra indent for steps nested inside a block

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

/**
 * Curved edge path. Sources depart downward (out of a square's bottom, so
 * the line never strikes through the source row's text — targets are always
 * later, i.e. lower); targets are approached horizontally.
 */
function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fromSide: boolean,
  toTop: boolean
): string {
  const dir = x2 >= x1 ? 1 : -1;
  const bend = Math.max(24, Math.min(70, Math.abs(x2 - x1) / 2.5));
  const c1 = fromSide
    ? `${x1 + bend * dir} ${y1}`
    : `${x1} ${y1 + Math.max(12, Math.min(48, (y2 - y1) * 0.8))}`;
  const c2 = toTop ? `${x2} ${y2 - Math.max(14, Math.min(40, y2 - y1))}` : `${x2 - bend * dir} ${y2}`;
  return `M ${x1} ${y1} C ${c1}, ${c2}, ${x2} ${y2}`;
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

  // Collapsed lanes (URL-persisted, comma-separated lane ids)
  const [collapsedParam, setCollapsedParam] = useQueryState(
    "collapsed",
    parseAsString.withDefault("")
  );
  const collapsed = useMemo(
    () => new Set(collapsedParam.split(",").filter(Boolean)),
    [collapsedParam]
  );
  const toggleLane = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsedParam([...next].join(",") || null);
  };

  // Lane x-geometry (variable widths because of collapse)
  const { laneX, laneW, width } = useMemo(() => {
    const laneX: number[] = [];
    const laneW: number[] = [];
    let x = GUTTER_W;
    for (const lane of layout.lanes) {
      laneX.push(x);
      const w = collapsed.has(lane.id) ? COLLAPSED_W : LANE_W;
      laneW.push(w);
      x += w;
    }
    return { laneX, laneW, width: x };
  }, [layout.lanes, collapsed]);

  const bodyHeight = layout.totalHeight;

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

  // --- anchor geometry -----------------------------------------------------

  const cellSquareX = (cell: TimelineCell): number => {
    if (collapsed.has(layout.lanes[cell.lane].id)) {
      return laneX[cell.lane] + laneW[cell.lane] / 2;
    }
    return laneX[cell.lane] + CELL_PAD + (cell.inBlock ? NEST_PAD : 0) + CELL / 2;
  };

  const blockRect = (block: TimelineBlock) => {
    const isCollapsed = collapsed.has(layout.lanes[block.lane].id);
    const left = laneX[block.lane] + (isCollapsed ? 4 : CELL_PAD - 2);
    const right = laneX[block.lane] + laneW[block.lane] - (isCollapsed ? 4 : CELL_PAD - 2);
    const top = layout.rowY[block.startRow] + 2;
    const bottom = layout.rowY[block.endRow] + layout.rowH[block.endRow] - 2;
    return { left, right, top, bottom, collapsed: isCollapsed };
  };

  const cellById = useMemo(() => {
    const m = new Map<string, TimelineCell>();
    for (const cell of layout.cells) m.set(cell.step.step_id, cell);
    return m;
  }, [layout.cells]);
  const blockById = useMemo(() => {
    const m = new Map<string, TimelineBlock>();
    for (const block of layout.blocks) m.set(block.run.run_id, block);
    return m;
  }, [layout.blocks]);

  // Edges anchor at the actual squares / block borders (not lane edges —
  // lane-edge anchors degenerate for adjacent lanes).
  const edgePaths = useMemo(() => {
    const centerOf = (id: string): { x: number; y: number } | null => {
      const cell = cellById.get(id);
      if (cell) return { x: cellSquareX(cell), y: rowCenterY(layout, cell.row) };
      const block = blockById.get(id);
      if (block) {
        const r = blockRect(block);
        return { x: (r.left + r.right) / 2, y: rowCenterY(layout, block.startRow) };
      }
      return null;
    };
    const anchorOf = (
      id: string,
      towardX: number,
      arrival: boolean
    ): { x: number; y: number; side: boolean; top: boolean } | null => {
      const cell = cellById.get(id);
      if (cell) {
        const cx = cellSquareX(cell);
        const cy = rowCenterY(layout, cell.row);
        if (arrival) {
          // from the left: land on the square's side (nothing is left of
          // it); from the right: land on its top, or the line would strike
          // through the row's own preview text
          if (towardX <= cx) {
            return { x: cx - CELL / 2 - 4, y: cy, side: true, top: false };
          }
          return { x: cx, y: cy - CELL / 2 - 2, side: false, top: true };
        }
        // depart out of the square's bottom, never through the row's text
        return { x: cx, y: cy + CELL / 2 + 1, side: false, top: false };
      }
      const block = blockById.get(id);
      if (block) {
        const r = blockRect(block);
        const cx = (r.left + r.right) / 2;
        const x = towardX >= cx ? r.right + (arrival ? 3 : 1) : r.left - (arrival ? 3 : 1);
        return { x, y: rowCenterY(layout, block.startRow), side: true, top: false };
      }
      return null;
    };

    const paths: { edge: (typeof layout.edges)[number]; d: string }[] = [];
    for (const edge of layout.edges) {
      const fromC = centerOf(edge.fromId);
      const toC = centerOf(edge.toId);
      if (!fromC || !toC) continue;
      const from = anchorOf(edge.fromId, toC.x, false);
      const to = anchorOf(edge.toId, fromC.x, true);
      if (!from || !to) continue;
      paths.push({ edge, d: edgePath(from.x, from.y, to.x, to.y, from.side, to.top) });
    }
    return paths;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, cellById, blockById, laneX, laneW, collapsed]);

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
            {layout.lanes.map((lane, i) => {
              const isCollapsed = collapsed.has(lane.id);
              return (
                <button
                  key={lane.id}
                  type="button"
                  onClick={() => toggleLane(lane.id)}
                  title={
                    isCollapsed ? `expand ${lane.label}` : `collapse ${lane.label}`
                  }
                  style={{ width: laneW[i] }}
                  className="group flex shrink-0 items-center gap-1 overflow-hidden border-l px-2 text-left hover:bg-accent/50"
                >
                  {isCollapsed ? (
                    <ChevronsLeftRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <>
                      <span
                        className={cn(
                          "truncate font-mono text-xs",
                          lane.kind === "thinker"
                            ? "font-medium"
                            : "text-muted-foreground"
                        )}
                      >
                        {lane.label}
                      </span>
                      <ChevronsRightLeft className="ml-auto h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {/* body */}
          <div className="relative" style={{ height: bodyHeight, width }}>
            {/* lane guides; collapsed lanes get a faint fill */}
            {layout.lanes.map((lane, i) => (
              <div
                key={lane.id}
                className={cn(
                  "absolute top-0 border-l border-border/50",
                  collapsed.has(lane.id) && "bg-muted/20"
                )}
                style={{ left: laneX[i], width: laneW[i], height: bodyHeight }}
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
              const r = blockRect(block);
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
                    "absolute z-10 flex flex-col rounded-md border text-left",
                    r.collapsed ? "px-0.5 py-0.5" : "px-2.5 py-1.5",
                    "border-blue-300 bg-blue-50/70 hover:bg-blue-100/70",
                    "dark:border-blue-800 dark:bg-blue-950/40 dark:hover:bg-blue-900/40",
                    running && "animate-pulse",
                    hot && "ring-2 ring-blue-400/60"
                  )}
                  style={{
                    left: r.left,
                    width: r.right - r.left,
                    top: r.top,
                    height: Math.max(r.bottom - r.top, 24),
                  }}
                  title={`[run] ${blockTitle(block)}`}
                >
                  {!r.collapsed && (
                    /* sticky so long blocks keep their summary in view mid-scroll */
                    <span
                      className="sticky flex w-full flex-col rounded bg-blue-50/90 px-1 dark:bg-blue-950/90"
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
                        {block.run.model && (
                          <> · {block.run.model.replace(/^claude-/, "")}</>
                        )}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}

            {/* step cells */}
            {layout.cells.map((cell) => {
              const y = rowCenterY(layout, cell.row);
              const hot = hovered === cell.step.step_id;
              const isCollapsed = collapsed.has(layout.lanes[cell.lane].id);
              const squareX = cellSquareX(cell);
              return (
                <button
                  key={cell.step.step_id}
                  type="button"
                  onClick={() => setSelected({ kind: "step", step: cell.step })}
                  onMouseEnter={() => setHovered(cell.step.step_id)}
                  onMouseLeave={() => setHovered(null)}
                  className="absolute z-10 flex items-center gap-1.5 text-left"
                  style={
                    isCollapsed
                      ? {
                          left: squareX - CELL / 2 - 2,
                          width: CELL + 4,
                          top: y - ROW_CLICK_H / 2,
                          height: ROW_CLICK_H,
                        }
                      : {
                          left: squareX - CELL / 2,
                          width:
                            laneX[cell.lane] +
                            laneW[cell.lane] -
                            (squareX - CELL / 2) -
                            CELL_PAD,
                          top: y - ROW_CLICK_H / 2,
                          height: ROW_CLICK_H,
                        }
                  }
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
                  {!isCollapsed && (
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
                  )}
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
