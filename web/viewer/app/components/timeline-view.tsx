// Timeline tab: swimlane view of a mind log. Time runs down; each writer
// gets a lane; runs are summary blocks in the launcher's lane; exact causal
// edges (trigger/dispatch/assoc/merge) are drawn as an SVG overlay.
//
// Edge routing is orthogonal through dedicated inter-lane gutters: an edge
// leaves its source downward, runs along the source row's bottom boundary
// into the gutter beside the source lane, travels vertically inside the
// gutter, then horizontally along the target's own row. Because ordinal
// rows hold exactly one event each, those horizontal runs cross only empty
// lane space — edges never strike through text by construction.
//
// Visibility is tiered: trigger→run edges (the structural story, one per
// run) are always on; dispatch/assoc/merge edges rest as faint ghosts and
// pop to full strength when an attached cell or block is hovered.

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
const LANE_GAP = 24; // inter-lane gutter, reserved for edge routing
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

/** Orthogonal polyline with rounded corners. */
function roundedPath(points: { x: number; y: number }[], r = 7): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const c = points[i];
    const n = points[i + 1];
    const inLen = Math.hypot(c.x - p.x, c.y - p.y);
    const outLen = Math.hypot(n.x - c.x, n.y - c.y);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    if (rr < 0.5) {
      d += ` L ${c.x} ${c.y}`;
      continue;
    }
    const inU = { x: (c.x - p.x) / inLen, y: (c.y - p.y) / inLen };
    const outU = { x: (n.x - c.x) / outLen, y: (n.y - c.y) / outLen };
    d += ` L ${c.x - inU.x * rr} ${c.y - inU.y * rr}`;
    d += ` Q ${c.x} ${c.y} ${c.x + outU.x * rr} ${c.y + outU.y * rr}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
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

  // Lane x-geometry: a routing gutter precedes every lane
  const { laneX, laneW, width } = useMemo(() => {
    const laneX: number[] = [];
    const laneW: number[] = [];
    let x = GUTTER_W;
    for (const lane of layout.lanes) {
      x += LANE_GAP;
      laneX.push(x);
      const w = collapsed.has(lane.id) ? COLLAPSED_W : LANE_W;
      laneW.push(w);
      x += w;
    }
    return { laneX, laneW, width: x + LANE_GAP };
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

  // --- geometry helpers ------------------------------------------------------

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

  // --- orthogonal edge routing ----------------------------------------------

  const edgePaths = useMemo(() => {
    const laneOf = (id: string): number | null =>
      cellById.get(id)?.lane ?? blockById.get(id)?.lane ?? null;

    const rowBottom = (row: number) => layout.rowY[row] + layout.rowH[row];

    const paths: { edge: (typeof layout.edges)[number]; d: string }[] = [];
    for (const edge of layout.edges) {
      const srcLane = laneOf(edge.fromId);
      const tgtLane = laneOf(edge.toId);
      if (srcLane === null || tgtLane === null) continue;

      // gutter beside the source lane, on the side facing the target
      const goRight = tgtLane > srcLane;
      const gx = goRight
        ? laneX[srcLane] + laneW[srcLane] + LANE_GAP / 2
        : laneX[srcLane] - LANE_GAP / 2;

      const pts: { x: number; y: number }[] = [];

      // -- departure --
      const srcCell = cellById.get(edge.fromId);
      if (srcCell) {
        // out of the square's bottom, along the row boundary, into the gutter
        const sx = cellSquareX(srcCell);
        const sy = rowCenterY(layout, srcCell.row);
        const sBound = rowBottom(srcCell.row);
        pts.push({ x: sx, y: sy + CELL / 2 + 1 }, { x: sx, y: sBound }, { x: gx, y: sBound });
      } else {
        const block = blockById.get(edge.fromId)!;
        const r = blockRect(block);
        const by = rowCenterY(layout, block.startRow);
        pts.push({ x: goRight ? r.right : r.left, y: by }, { x: gx, y: by });
      }

      // -- arrival --
      const tgtCell = cellById.get(edge.toId);
      if (tgtCell) {
        const tx = cellSquareX(tgtCell);
        const ty = rowCenterY(layout, tgtCell.row);
        if (gx <= tx) {
          // approach from the left, straight into the square's side
          pts.push({ x: gx, y: ty }, { x: tx - CELL / 2 - 3, y: ty });
        } else {
          // approach from the right: run along the boundary above the
          // target's row, then drop into the square's top — never across
          // the row's own text
          const tBound = layout.rowY[tgtCell.row];
          pts.push({ x: gx, y: tBound }, { x: tx, y: tBound }, { x: tx, y: ty - CELL / 2 - 2 });
        }
      } else {
        const block = blockById.get(edge.toId)!;
        const r = blockRect(block);
        const by = rowCenterY(layout, block.startRow);
        const arriveX = gx <= (r.left + r.right) / 2 ? r.left - 2 : r.right + 2;
        pts.push({ x: gx, y: by }, { x: arriveX, y: by });
      }

      paths.push({ edge, d: roundedPath(pts) });
    }
    return paths;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, cellById, blockById, laneX, laneW, collapsed]);

  // Tiered visibility: triggers always on; the rest ghost until hovered.
  const edgeStyle = (edge: (typeof layout.edges)[number]) => {
    const hot = hovered !== null && (edge.fromId === hovered || edge.toId === hovered);
    if (hot) return { opacity: 1, width: 2.2, halo: true };
    if (hovered !== null)
      return { opacity: edge.kind === "trigger" ? 0.12 : 0.05, width: 1.25, halo: false };
    if (edge.kind === "trigger") return { opacity: 0.7, width: 1.5, halo: true };
    return { opacity: 0.14, width: 1.25, halo: false };
  };

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
            className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur"
            style={{ height: HEADER_H, width }}
          >
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
                  style={{ left: laneX[i], width: laneW[i], height: HEADER_H }}
                  className="group absolute top-0 flex items-center gap-1 overflow-hidden rounded-t border-x border-t border-border/50 px-2 text-left hover:bg-accent/50"
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
            {/* lane columns */}
            {layout.lanes.map((lane, i) => (
              <div
                key={lane.id}
                className={cn(
                  "absolute top-0 border-x border-border/40",
                  collapsed.has(lane.id) ? "bg-muted/20" : "bg-muted/[0.07]"
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
                    markerWidth="5.5"
                    markerHeight="5.5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" fill={color} />
                  </marker>
                ))}
              </defs>
              {edgePaths.map(({ edge, d }) => {
                const s = edgeStyle(edge);
                return (
                  <g key={edge.id} opacity={s.opacity}>
                    {s.halo && (
                      <path
                        d={d}
                        fill="none"
                        stroke="var(--color-background)"
                        strokeWidth={s.width + 2.5}
                      />
                    )}
                    <path
                      d={d}
                      fill="none"
                      stroke={EDGE_STROKE[edge.kind]}
                      strokeWidth={s.width}
                      markerEnd={`url(#arrow-${edge.kind})`}
                    />
                  </g>
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
