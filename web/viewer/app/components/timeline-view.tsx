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
//
// Lanes can be collapsed (narrow square-strip), hidden, and reordered; all
// three are URL-persisted (?collapsed= / ?hidden= / ?laneorder=).

import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  ChevronsLeftRight,
  ChevronsRightLeft,
  EyeOff,
  Pause,
} from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useMemo, useRef, useState } from "react";

import { TimelineDetailModal, type TimelineSelection } from "~/components/timeline-detail";
import { timelineColor } from "~/lib/step-colors";
import {
  GUTTER_W,
  HEADER_H,
  LANE_W,
  MONO_LANE_W,
  ROW_H,
  rowCenterY,
  type EdgeKind,
  type TimelineBlock,
  type TimelineCell,
  type TimelineLane,
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
const BLOCK_INSET = CELL_PAD - 2; // block edge inset from the lane edge
const NEST_PAD = 10; // nested steps align with the block's inner padding

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
  const [selected, setSelected] = useState<TimelineSelection | null>(null);

  // Lane display state (all URL-persisted, comma-separated lane ids)
  const [collapsedParam, setCollapsedParam] = useQueryState(
    "collapsed",
    parseAsString.withDefault("")
  );
  const [hiddenParam, setHiddenParam] = useQueryState(
    "hidden",
    parseAsString.withDefault("")
  );
  const [orderParam, setOrderParam] = useQueryState(
    "laneorder",
    parseAsString.withDefault("")
  );
  const collapsed = useMemo(
    () => new Set(collapsedParam.split(",").filter(Boolean)),
    [collapsedParam]
  );
  const hidden = useMemo(
    () => new Set(hiddenParam.split(",").filter(Boolean)),
    [hiddenParam]
  );

  const toggleLane = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsedParam([...next].join(",") || null);
  };
  const hideLane = (id: string) => {
    setHiddenParam([...new Set([...hidden, id])].join(","));
  };
  const unhideLane = (id: string) => {
    const next = new Set(hidden);
    next.delete(id);
    setHiddenParam([...next].join(",") || null);
  };

  // Visible lanes in display order; map original lane index -> display index
  const displayLanes: TimelineLane[] = useMemo(() => {
    const ids = layout.lanes.map((l) => l.id);
    const pref = orderParam.split(",").filter((id) => ids.includes(id));
    const ordered = [...pref, ...ids.filter((id) => !pref.includes(id))];
    return ordered
      .filter((id) => !hidden.has(id))
      .map((id) => layout.lanes.find((l) => l.id === id)!);
  }, [layout.lanes, orderParam, hidden]);

  const dispIdxById = useMemo(
    () => new Map(displayLanes.map((l, i) => [l.id, i])),
    [displayLanes]
  );
  const disp = (origLane: number): number | undefined =>
    dispIdxById.get(layout.lanes[origLane].id);

  const moveLane = (id: string, dir: -1 | 1) => {
    const ids = displayLanes.map((l) => l.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrderParam(ids.join(","));
  };

  // Lane x-geometry (display order): a routing gutter precedes every lane
  const { laneX, laneW, width } = useMemo(() => {
    const laneX: number[] = [];
    const laneW: number[] = [];
    let x = GUTTER_W;
    for (const lane of displayLanes) {
      x += LANE_GAP;
      laneX.push(x);
      const w = collapsed.has(lane.id)
        ? COLLAPSED_W
        : lane.id === "inner_monologue"
          ? MONO_LANE_W
          : LANE_W;
      laneW.push(w);
      x += w;
    }
    return { laneX, laneW, width: x + LANE_GAP };
  }, [displayLanes, collapsed]);

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

  // --- geometry helpers (display coordinates; null when the lane is hidden) --

  const cellSquareX = (cell: TimelineCell): number | null => {
    const d = disp(cell.lane);
    if (d === undefined) return null;
    if (collapsed.has(layout.lanes[cell.lane].id)) {
      return laneX[d] + laneW[d] / 2;
    }
    if (cell.inBlock) {
      return laneX[d] + BLOCK_INSET + NEST_PAD + CELL / 2;
    }
    return laneX[d] + CELL_PAD + CELL / 2;
  };

  const blockRect = (block: TimelineBlock) => {
    const d = disp(block.lane);
    if (d === undefined) return null;
    const isCollapsed = collapsed.has(layout.lanes[block.lane].id);
    const left = laneX[d] + (isCollapsed ? 4 : BLOCK_INSET);
    const right = laneX[d] + laneW[d] - (isCollapsed ? 4 : BLOCK_INSET);
    const top = layout.rowY[block.startRow] + 2;
    const bottom = layout.rowY[block.endRow] + layout.rowH[block.endRow] - 2;
    return { left, right, top, bottom, collapsed: isCollapsed, d };
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

  // Every step (cells + run members), for the modal's related-item lookups
  const stepById = useMemo(() => {
    const m = new Map<string, NormalizedStep>();
    for (const cell of layout.cells) m.set(cell.step.step_id, cell.step);
    for (const block of layout.blocks) {
      for (const member of block.members) m.set(member.step_id, member);
    }
    return m;
  }, [layout.cells, layout.blocks]);

  // --- orthogonal edge routing ----------------------------------------------

  const edgePaths = useMemo(() => {
    const dispLaneOf = (id: string): number | undefined => {
      const lane = cellById.get(id)?.lane ?? blockById.get(id)?.lane;
      return lane === undefined ? undefined : disp(lane);
    };

    const rowBottom = (row: number) => layout.rowY[row] + layout.rowH[row];

    const paths: {
      edge: (typeof layout.edges)[number];
      d: string;
      start: { x: number; y: number };
      end: { x: number; y: number };
    }[] = [];
    for (const edge of layout.edges) {
      const srcLane = dispLaneOf(edge.fromId);
      const tgtLane = dispLaneOf(edge.toId);
      if (srcLane === undefined || tgtLane === undefined) continue; // hidden

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
        const sx = cellSquareX(srcCell)!;
        const sy = rowCenterY(layout, srcCell.row);
        const sBound = rowBottom(srcCell.row);
        pts.push({ x: sx, y: sy + CELL / 2 + 1 }, { x: sx, y: sBound }, { x: gx, y: sBound });
      } else {
        const block = blockById.get(edge.fromId)!;
        const r = blockRect(block)!;
        const by = rowCenterY(layout, block.startRow);
        pts.push({ x: goRight ? r.right : r.left, y: by }, { x: gx, y: by });
      }

      // -- arrival --
      const tgtCell = cellById.get(edge.toId);
      if (tgtCell) {
        const tx = cellSquareX(tgtCell)!;
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
        const r = blockRect(block)!;
        const by = rowCenterY(layout, block.startRow);
        const arriveX = gx <= (r.left + r.right) / 2 ? r.left - 2 : r.right + 2;
        pts.push({ x: gx, y: by }, { x: arriveX, y: by });
      }

      paths.push({ edge, d: roundedPath(pts), start: pts[0], end: pts[pts.length - 1] });
    }
    return paths;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, cellById, blockById, laneX, laneW, collapsed, dispIdxById]);

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
      {hidden.size > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] text-muted-foreground">hidden:</span>
          {[...hidden].map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => unhideLane(id)}
              title={`show ${id}`}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <EyeOff className="h-2.5 w-2.5" />
              {id}
            </button>
          ))}
        </div>
      )}
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
            {displayLanes.map((lane, i) => {
              const isCollapsed = collapsed.has(lane.id);
              if (isCollapsed) {
                return (
                  <button
                    key={lane.id}
                    type="button"
                    onClick={() => toggleLane(lane.id)}
                    title={`expand ${lane.label}`}
                    style={{ left: laneX[i], width: laneW[i], height: HEADER_H }}
                    className="absolute top-0 flex items-center justify-center rounded-t bg-muted/[0.12] hover:bg-accent/50"
                  >
                    <ChevronsLeftRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                );
              }
              return (
                <div
                  key={lane.id}
                  style={{ left: laneX[i], width: laneW[i], height: HEADER_H }}
                  className="group absolute top-0 flex items-center gap-0.5 overflow-hidden rounded-t bg-muted/[0.12] pl-2 pr-1"
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-xs",
                      lane.kind === "thinker" ? "font-medium" : "text-muted-foreground"
                    )}
                  >
                    {lane.label}
                  </span>
                  <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => moveLane(lane.id, -1)}
                      title="move left"
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveLane(lane.id, 1)}
                      title="move right"
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ChevronRight className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleLane(lane.id)}
                      title={`collapse ${lane.label}`}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ChevronsRightLeft className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => hideLane(lane.id)}
                      title={`hide ${lane.label}`}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <EyeOff className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          {/* body */}
          <div className="relative" style={{ height: bodyHeight, width }}>
            {/* lane columns — fills only, no borders; the gutters between
                them are open routing channels */}
            {displayLanes.map((lane, i) => (
              <div
                key={lane.id}
                className={cn(
                  "absolute top-0 rounded-b",
                  collapsed.has(lane.id) ? "bg-muted/25" : "bg-muted/[0.12]"
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
              {/* No arrowheads: time flows down, so direction is implied —
                  endpoints are dots (source small, target larger). */}
              {edgePaths.map(({ edge, d, start, end }) => {
                const s = edgeStyle(edge);
                const color = EDGE_STROKE[edge.kind];
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
                    <path d={d} fill="none" stroke={color} strokeWidth={s.width} />
                    <circle cx={start.x} cy={start.y} r={s.width + 0.5} fill={color} />
                    <circle cx={end.x} cy={end.y} r={s.width + 1.5} fill={color} />
                  </g>
                );
              })}
            </svg>

            {/* run blocks (background + border; the summary chip is painted
                in a separate layer above the cells, see below) */}
            {layout.blocks.map((block) => {
              const r = blockRect(block);
              if (!r) return null; // hidden lane
              const running = block.open && live;
              const hot = hovered === block.run.run_id;
              return (
                <button
                  key={block.run.run_id}
                  type="button"
                  onClick={() => setSelected({ kind: "run", block })}
                  onMouseEnter={() => setHovered(block.run.run_id)}
                  onMouseLeave={() => setHovered(null)}
                  className={cn(
                    "absolute z-10 rounded-md border text-left",
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
                />
              );
            })}

            {/* step cells */}
            {layout.cells.map((cell) => {
              const squareX = cellSquareX(cell);
              if (squareX === null) return null; // hidden lane
              const d = disp(cell.lane)!;
              const y = rowCenterY(layout, cell.row);
              const hot = hovered === cell.step.step_id;
              const isCollapsed = collapsed.has(layout.lanes[cell.lane].id);
              const tall = layout.rowH[cell.row] > ROW_H; // two-line monologue row
              const clickH = tall ? 34 : ROW_CLICK_H;
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
                          top: y - clickH / 2,
                          height: clickH,
                        }
                      : {
                          left: squareX - CELL / 2,
                          width:
                            laneX[d] +
                            laneW[d] -
                            (squareX - CELL / 2) -
                            (cell.inBlock ? BLOCK_INSET + NEST_PAD : CELL_PAD),
                          top: y - clickH / 2,
                          height: clickH,
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
                        "min-w-0 flex-1 text-[10px]",
                        tall
                          ? "line-clamp-2 break-words leading-[13px]"
                          : "truncate leading-none",
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

            {/* run summary chips — a layer above the cells so the sticky
                chip cleanly occludes nested steps while it floats, instead
                of z-fighting their text */}
            {layout.blocks.map((block) => {
              const r = blockRect(block);
              if (!r || r.collapsed) return null;
              const iters = block.members.filter((m) => m.type === "shell-output").length;
              const duration = durationOf(block.run.started_ts, block.run.ended_ts);
              return (
                <div
                  key={`chip-${block.run.run_id}`}
                  className="pointer-events-none absolute z-10 flex flex-col px-1.5 py-1"
                  style={{
                    left: r.left,
                    width: r.right - r.left,
                    top: r.top,
                    height: Math.max(r.bottom - r.top, 24),
                  }}
                >
                  {/* sticky so long blocks keep their summary in view mid-scroll */}
                  <button
                    type="button"
                    onClick={() => setSelected({ kind: "run", block })}
                    onMouseEnter={() => setHovered(block.run.run_id)}
                    onMouseLeave={() => setHovered(null)}
                    className="pointer-events-auto sticky flex w-full flex-col rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-left shadow-sm dark:border-blue-900 dark:bg-blue-950"
                    style={{ top: HEADER_H + 4 }}
                    title={`[run] ${blockTitle(block)}`}
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
                  </button>
                </div>
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
        <TimelineDetailModal
          selected={selected}
          onClose={() => setSelected(null)}
          onSelect={setSelected}
          stepById={stepById}
          blockByRun={blockById}
        />
      )}
    </div>
  );
}
