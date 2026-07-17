// Wire types for the shellm web viewer API.

export interface Config {
  root: string;
  version: string;
  controls_enabled: boolean;
  self_update_enabled: boolean;
  git_commit: string | null;
  git_branch: string | null;
}

export interface SelfUpdateResult {
  ok: boolean;
  updated: boolean;
  restarting: boolean;
  commit?: string;
  from_commit?: string;
  to_commit?: string;
}

export interface DispatcherStatus {
  running: boolean;
  pid: number | null;
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
  dispatcher: DispatcherStatus;
  thinkers_total: number;
  thinkers_active: number;
  steps_in_flight: number;
}

export type ThinkerState = "stopped" | "idle" | "active" | "running" | "disabled";

export interface ThinkerInfo {
  name: string;
  state: ThinkerState;
  steps_in_flight: number;
  pid: number | null;
  types: string[];
  trigger_self: boolean;
  pending: string[];
  log_bytes: number | null;
  log_mtime: string | null;
}

export interface ThinkersStatus {
  identity: { id: string; name: string };
  dispatcher: DispatcherStatus;
  active_thinkers: number;
  thinkers_total: number;
  thinkers_disabled: number;
  steps_in_flight: number;
  pending_total: number;
  thinkers: ThinkerInfo[];
}

export interface ControlResult {
  ok: boolean;
  action: string;
  names: string[];
  exit_code?: number;
  stdout?: string;
  stderr?: string;
}

export interface ChatMessage {
  ts: string | null;
  step_id: string | null;
  from: string;
  to: string;
  content: string;
  filename: string | null;
}

export interface ChatLog {
  identity: { id: string; name: string };
  live: boolean;
  messages: ChatMessage[];
}

export interface EnvEntry {
  key: string;
  value: string; // full value for non-secrets, redacted peek for secrets
  secret: boolean;
  overridden?: boolean; // inherited entries only
}

export interface IdentityEnv {
  identity: { id: string; name: string };
  env: EnvEntry[];
  inherited: EnvEntry[];
  note: string;
}

export interface KillallResult {
  ok: boolean;
  dry_run: boolean;
  stdout: string;
  stderr: string;
}

export interface ImportResult {
  ok: boolean;
  imported: { id: string; name: string }[];
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
