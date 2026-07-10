// Pure layout model for the Timeline tab: turns a mind log's {steps, runs}
// into lanes (one per writer), ordinal rows, cells (one square per step),
// run blocks (machinery collapsed into the launcher's lane), gap dividers,
// and exact causal edges. All coordinates are deterministic (fixed per-row
// heights), so the SVG edge overlay needs no DOM measurement.

import type { Mindlog, NormalizedStep, RunGroup } from "~/lib/types";

// --- geometry constants (px) ---
export const GUTTER_W = 72; // wall-clock column
export const LANE_W = 200;
export const MONO_LANE_W = 320; // the monologue is the narrative spine — wider
export const ROW_H = 26;
export const MID_ROW_H = 40; // two-line rows for thinker/chat content steps
export const TALL_ROW_H = 52; // three-line rows for the monologue — the narrator
export const BLOCK_ROW_H = 64; // rows where a run block starts (chip with 2-line title)
export const GAP_ROW_H = 26;
export const HEADER_H = 34; // sticky lane-header strip

const GAP_THRESHOLD_MS = 60_000;

export interface TimelineLane {
  id: string; // source name, "chat", or "shellm" (fallback)
  label: string;
  kind: "thinker" | "chat" | "shellm";
}

export interface TimelineCell {
  step: NormalizedStep;
  lane: number;
  row: number;
  /** step written from inside a run whose block covers this cell — render nested */
  inBlock?: boolean;
}

export interface TimelineBlock {
  run: RunGroup;
  lane: number;
  startRow: number;
  endRow: number; // inclusive
  members: NormalizedStep[];
  open: boolean; // still running (no final seen)
}

export interface TimelineGapRow {
  row: number;
  label: string; // "4m 12s"
}

export type EdgeKind = "trigger" | "dispatch" | "merge" | "assoc";

export interface TimelineEdge {
  id: string;
  kind: EdgeKind;
  fromId: string; // step_id or run_id — used for hover highlighting
  toId: string;
  from: { lane: number; row: number };
  to: { lane: number; row: number };
}

export interface TimelineLayout {
  lanes: TimelineLane[];
  cells: TimelineCell[];
  blocks: TimelineBlock[];
  gaps: TimelineGapRow[];
  edges: TimelineEdge[];
  rowY: number[]; // top of each row
  rowH: number[];
  totalHeight: number;
  totalWidth: number;
  /** hh:mm:ss gutter label per row ("" = same as previous row) */
  rowClock: string[];
}

function fmtGap(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// Local wall clock. Mind logs can mix timezone offsets (steps written from
// inside a run's environment may use a different offset), so parse and
// normalize rather than slicing the raw string.
function clock(ts: string): string {
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return ts.length >= 19 ? ts.slice(11, 19) : ts;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function epoch(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? 0 : ms;
}

function rawStr(step: NormalizedStep, key: string): string | null {
  const v = step.raw[key];
  return typeof v === "string" && v !== "" ? v : null;
}

const LANE_PRIORITY = ["inner_monologue", "actor"];

export function buildTimeline(mindlog: Pick<Mindlog, "steps" | "runs">): TimelineLayout {
  const { steps, runs } = mindlog;
  const runsById = new Map(runs.map((r) => [r.run_id, r]));

  // Machinery members render inside their run's block, not as cells.
  // The header anchors the block. Members keep header first, file order after.
  const memberOf = new Map<string, RunGroup>();
  for (const run of runs) {
    for (const id of run.step_ids) memberOf.set(id, run);
  }
  const membersByRun = new Map<string, NormalizedStep[]>();
  for (const step of steps) {
    const run = memberOf.get(step.step_id);
    if (run) {
      let list = membersByRun.get(run.run_id);
      if (!list) membersByRun.set(run.run_id, (list = []));
      list.push(step);
    }
  }

  // --- lanes, derived from data ---
  // A step's lane: its source; machinery/blocks: the run's launched_by;
  // source-less non-machinery (legacy write-backs, structural steps) fall
  // back to their associated run's launcher, else the "shellm" lane.
  const laneIds: string[] = [];
  const laneOf = new Map<string, number>();
  const laneFor = (id: string): number => {
    let idx = laneOf.get(id);
    if (idx === undefined) {
      idx = laneIds.length;
      laneIds.push(id);
      laneOf.set(id, idx);
    }
    return idx;
  };
  const laneIdFor = (step: NormalizedStep): string => {
    if (step.source === "chat") return "chat";
    if (step.source) return step.source;
    const assocRun = runsById.get(rawStr(step, "run_id") ?? "");
    return assocRun?.launched_by ?? "shellm";
  };
  // Seed priority lanes only if present in the data, in a stable order.
  const sourcesSeen = new Set<string>();
  for (const step of steps) {
    sourcesSeen.add(laneIdFor(step));
    const run = memberOf.get(step.step_id);
    if (run && step.type === "shellm-run") sourcesSeen.add(run.launched_by ?? "shellm");
  }
  for (const id of LANE_PRIORITY) if (sourcesSeen.has(id)) laneFor(id);

  // --- rows ---
  const cells: TimelineCell[] = [];
  const blocks: TimelineBlock[] = [];
  const gaps: TimelineGapRow[] = [];
  const rowH: number[] = [];
  const rowClock: string[] = [];
  const rowMs: number[] = []; // epoch ms of the item on each row (0 for gaps)
  let prevMs = 0;
  let prevClock = "";

  const pushRow = (h: number, ts: string): number => {
    rowH.push(h);
    rowMs.push(ts ? epoch(ts) : 0);
    const c = ts ? clock(ts) : "";
    rowClock.push(c && c !== prevClock ? c : "");
    if (c) prevClock = c;
    return rowH.length - 1;
  };

  const cellByStepId = new Map<string, TimelineCell>();
  const blockByRunId = new Map<string, TimelineBlock>();

  for (const step of steps) {
    if (step.type === "trajectory") continue; // file preamble, not an event
    const run = memberOf.get(step.step_id);
    if (run && step.type !== "shellm-run") continue; // inside a block

    // gap divider
    const stepMs = step.ts ? epoch(step.ts) : 0;
    if (prevMs && stepMs) {
      const delta = stepMs - prevMs;
      if (delta > GAP_THRESHOLD_MS) {
        gaps.push({ row: pushRow(GAP_ROW_H, ""), label: fmtGap(delta) });
      }
    }
    if (stepMs) prevMs = stepMs;

    if (run && step.type === "shellm-run") {
      const lane = laneFor(run.launched_by ?? "shellm");
      const row = pushRow(BLOCK_ROW_H, step.ts);
      const block: TimelineBlock = {
        run,
        lane,
        startRow: row,
        endRow: row,
        members: membersByRun.get(run.run_id) ?? [],
        open: run.status !== "done",
      };
      blocks.push(block);
      blockByRunId.set(run.run_id, block);
    } else {
      const lane = laneFor(laneIdFor(step));
      // Preview depth: the monologue narrates (3 lines); other sourced
      // content steps get 2; machinery/structural strays and idles get 1.
      const h =
        step.type === "idle"
          ? ROW_H
          : step.source === "inner_monologue"
            ? TALL_ROW_H
            : step.source
              ? MID_ROW_H
              : ROW_H;
      const row = pushRow(h, step.ts);
      const cell = { step, lane, row };
      cells.push(cell);
      cellByStepId.set(step.step_id, cell);
    }
  }

  // Block extent: a run spans down to the last row whose item started
  // before the run's end (concurrent activity stays visibly "inside" the
  // run's lifetime). For an open run the "end" is its latest member's ts —
  // which keeps growing while live — so a legacy member-less header stays
  // a point block instead of stretching to the bottom of the log.
  const lastRow = rowH.length - 1;
  for (const block of blocks) {
    let endMs = block.run.ended_ts ? epoch(block.run.ended_ts) : 0;
    if (!endMs) {
      for (const m of block.members) {
        const ms = m.ts ? epoch(m.ts) : 0;
        if (ms > endMs) endMs = ms;
      }
    }
    if (!endMs) continue;
    let end = block.startRow;
    for (let r = block.startRow + 1; r <= lastRow; r++) {
      if (rowMs[r] && rowMs[r] <= endMs) end = r;
    }
    block.endRow = end;
  }

  // Mark cells sitting inside a same-lane block's span (steps the run wrote
  // into its own launcher's lane) so the view can render them nested.
  for (const cell of cells) {
    const block = blockByRunId.get(rawStr(cell.step, "run_id") ?? "");
    if (
      block &&
      block.lane === cell.lane &&
      cell.row > block.startRow &&
      cell.row <= block.endRow
    ) {
      cell.inBlock = true;
    }
  }

  // --- edges ---
  const edges: TimelineEdge[] = [];
  const seenEdge = new Set<string>();
  const addEdge = (
    kind: EdgeKind,
    fromId: string,
    from: { lane: number; row: number },
    toId: string,
    to: { lane: number; row: number }
  ) => {
    const id = `${kind}:${fromId}->${toId}`;
    if (seenEdge.has(id)) return;
    seenEdge.add(id);
    edges.push({ id, kind, fromId, toId, from, to });
  };

  // trigger step -> run block (exact, from trigger_step_id)
  for (const block of blocks) {
    const trig = block.run.trigger_step_id;
    const cell = trig ? cellByStepId.get(trig) : undefined;
    if (cell) {
      addEdge(
        "trigger",
        cell.step.step_id,
        { lane: cell.lane, row: cell.row },
        block.run.run_id,
        { lane: block.lane, row: block.startRow }
      );
    }
  }

  // dispatch edge: a directly-appended thinker step names its trigger.
  // Skip same-lane edges (the monologue's self-chain is noise, not signal).
  for (const cell of cells) {
    const trig = rawStr(cell.step, "trigger_step");
    if (!trig) continue;
    const from = cellByStepId.get(trig);
    if (from && from.lane !== cell.lane) {
      addEdge(
        "dispatch",
        from.step.step_id,
        { lane: from.lane, row: from.row },
        cell.step.step_id,
        { lane: cell.lane, row: cell.row }
      );
    }
  }

  // run block -> steps written from inside it (observation, fork, merge…)
  for (const cell of cells) {
    const runId = rawStr(cell.step, "run_id");
    const block = runId ? blockByRunId.get(runId) : undefined;
    if (block && block.lane !== cell.lane) {
      addEdge(
        "assoc",
        block.run.run_id,
        { lane: block.lane, row: block.startRow },
        cell.step.step_id,
        { lane: cell.lane, row: cell.row }
      );
    }
  }

  // merge -> its fork
  const forkByChild = new Map<string, TimelineCell>();
  for (const cell of cells) {
    if (cell.step.type === "fork" && cell.step.fork) {
      forkByChild.set(cell.step.fork.child_traj_id, cell);
    }
  }
  for (const cell of cells) {
    if (cell.step.type !== "merge") continue;
    const from = rawStr(cell.step, "from_traj");
    const fork = from ? forkByChild.get(from) : undefined;
    if (fork) {
      addEdge(
        "merge",
        fork.step.step_id,
        { lane: fork.lane, row: fork.row },
        cell.step.step_id,
        { lane: cell.lane, row: cell.row }
      );
    }
  }

  // --- final geometry ---
  const rowY: number[] = [];
  let y = 0;
  for (const h of rowH) {
    rowY.push(y);
    y += h;
  }

  const lanes: TimelineLane[] = laneIds.map((id) => ({
    id,
    label: id,
    kind: id === "chat" ? "chat" : id === "shellm" ? "shellm" : "thinker",
  }));

  return {
    lanes,
    cells,
    blocks,
    gaps,
    edges,
    rowY,
    rowH,
    rowClock,
    totalHeight: y,
    totalWidth: GUTTER_W + lanes.length * LANE_W,
  };
}

export function laneCenterX(lane: number): number {
  return GUTTER_W + lane * LANE_W + LANE_W / 2;
}

export function rowCenterY(layout: TimelineLayout, row: number): number {
  return layout.rowY[row] + layout.rowH[row] / 2;
}
