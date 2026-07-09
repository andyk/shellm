// Per-step-type colors, ported from bin/traj's terminal color scheme.
// Each entry: left-border accent, type-chip classes.

import type { StepType } from "~/lib/types";

export interface StepColor {
  border: string;
  chip: string;
}

const COLORS: Record<string, StepColor> = {
  thought: {
    border: "border-l-sky-400 dark:border-l-sky-500",
    chip: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  },
  "tp-thought": {
    border: "border-l-sky-300 dark:border-l-sky-600",
    chip: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-400",
  },
  reasoning: {
    border: "border-l-cyan-400 dark:border-l-cyan-500",
    chip: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300",
  },
  action: {
    border: "border-l-amber-400 dark:border-l-amber-500",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  observation: {
    border: "border-l-green-400 dark:border-l-green-500",
    chip: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  },
  message: {
    border: "border-l-violet-400 dark:border-l-violet-500",
    chip: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  },
  "human-msg": {
    border: "border-l-violet-400 dark:border-l-violet-500",
    chip: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  },
  "agent-msg": {
    border: "border-l-emerald-400 dark:border-l-emerald-500",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  feedback: {
    border: "border-l-rose-400 dark:border-l-rose-500",
    chip: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  },
  final: {
    border: "border-l-emerald-400 dark:border-l-emerald-500",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  fork: {
    border: "border-l-fuchsia-400 dark:border-l-fuchsia-500",
    chip: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300",
  },
  merge: {
    border: "border-l-fuchsia-400 dark:border-l-fuchsia-500",
    chip: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300",
  },
  trajectory: {
    border: "border-l-purple-400 dark:border-l-purple-500",
    chip: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  },
  "shellm-run": {
    border: "border-l-blue-400 dark:border-l-blue-500",
    chip: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  prompt: {
    border: "border-l-slate-300 dark:border-l-slate-600",
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400",
  },
  "shell-output": {
    border: "border-l-zinc-300 dark:border-l-zinc-600",
    chip: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
  },
  "run-summary": {
    border: "border-l-teal-400 dark:border-l-teal-500",
    chip: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  },
  idle: {
    border: "border-l-neutral-200 dark:border-l-neutral-700",
    chip: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
  },
};

const FALLBACK: StepColor = {
  border: "border-l-neutral-300 dark:border-l-neutral-600",
  chip: "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400",
};

export function stepColor(type: StepType | string): StepColor {
  return COLORS[type] ?? FALLBACK;
}

// Solid segment colors for the timeline bar.
const TIMELINE: Record<string, string> = {
  thought: "bg-sky-400 dark:bg-sky-500",
  "tp-thought": "bg-sky-300 dark:bg-sky-600",
  reasoning: "bg-cyan-400 dark:bg-cyan-500",
  action: "bg-amber-400 dark:bg-amber-500",
  observation: "bg-green-400 dark:bg-green-500",
  message: "bg-violet-400 dark:bg-violet-500",
  "human-msg": "bg-violet-400 dark:bg-violet-500",
  "agent-msg": "bg-emerald-400 dark:bg-emerald-500",
  feedback: "bg-rose-400 dark:bg-rose-500",
  final: "bg-emerald-400 dark:bg-emerald-500",
  fork: "bg-fuchsia-400 dark:bg-fuchsia-500",
  merge: "bg-fuchsia-400 dark:bg-fuchsia-500",
  trajectory: "bg-purple-400 dark:bg-purple-500",
  "shellm-run": "bg-blue-400 dark:bg-blue-500",
  prompt: "bg-slate-300 dark:bg-slate-600",
  "shell-output": "bg-zinc-300 dark:bg-zinc-600",
  "run-summary": "bg-teal-400 dark:bg-teal-500",
  idle: "bg-neutral-200 dark:bg-neutral-700",
};

export function timelineColor(type: StepType | string): string {
  return TIMELINE[type] ?? "bg-neutral-300 dark:bg-neutral-600";
}
