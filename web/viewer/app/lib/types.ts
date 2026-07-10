// Wire types for the shellm web viewer API.

export interface Config {
  root: string;
  version: string;
}

export interface Identity {
  id: string;
  name: string;
  path_rel: string;
  created: string | null;
  root_trajectory: string | null;
  group: string;
  live: boolean;
  last_activity_ts: string | null;
  step_count: number;
}

export interface IdentityStatus {
  live: boolean;
  pid_alive: boolean;
  dispatcher_pid: number | null;
  mindlog_mtime: string | null;
  mindlog_bytes: number | null;
  step_count: number;
}

export type StepType =
  | "trajectory"
  | "thought"
  | "action"
  | "idle"
  | "observation"
  | "message"
  | "shellm-run"
  | "prompt"
  | "reasoning"
  | "shell-output"
  | "feedback"
  | "final"
  | "fork"
  | "run-summary"
  | "tp-thought"
  | "human-msg"
  | "agent-msg"
  | "merge";

export type StepSource =
  | "seed"
  | "inner_monologue"
  | "actor"
  | "chat"
  | (string & {})
  | null;

export interface ForkLink {
  child_traj_id: string;
  slug: string;
  resolved: boolean;
}

export interface WritebackLink {
  from_traj: string;
  from_step: string | null;
}

export interface NormalizedStep {
  step_id: string;
  ts: string;
  type: StepType;
  source: StepSource;
  preview: string;
  raw: Record<string, unknown>;
  run_id: string | null;
  fork?: ForkLink;
  writeback?: WritebackLink;
}

export interface RunGroup {
  run_id: string;
  trigger_step_id: string | null;
  launched_by: string | null;
  step_ids: string[];
  started_ts: string;
  ended_ts: string | null;
  status: "running" | "done";
  command: string;
  model: string | null;
  tldr: string | null;
}

export interface Mindlog {
  traj_id: string;
  dir_rel: string;
  step_count: number;
  steps: NormalizedStep[];
  runs: RunGroup[];
  live: boolean;
  identity: { id: string; name: string };
}

export interface TreeNode {
  traj_id: string;
  slug: string;
  parent_step_id: string | null;
  started_ts: string;
  last_ts: string;
  step_count: number;
  has_final: boolean;
  tldr: string | null;
  child_count: number;
  children?: TreeNode[];
}

export interface Crumb {
  traj_id: string;
  slug: string;
}

export interface SubTrajectory extends Mindlog {
  breadcrumb: Crumb[];
  parent: { traj_id: string; step_id: string | null } | null;
}

export interface LogInfo {
  name: string;
  bytes: number;
  mtime: number;
}

export interface LogTail {
  name: string;
  content: string;
  total_bytes: number;
  truncated: boolean;
}

export interface DispatchEvent {
  kind: "step" | "dispatch" | "other";
  type?: string;
  source?: string | null;
  thinker?: string;
  active?: number | null;
  raw: string;
}

export interface MemoryInfo {
  name: string;
  mtime: number;
}
