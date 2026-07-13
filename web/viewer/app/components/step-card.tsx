import { GitFork, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { BlobLoader } from "~/components/blob-output";
import { ExpandableText } from "~/components/expandable-text";
import { StepHeader } from "~/components/step-header";
import { Badge } from "~/components/ui/badge";
import { CodeBlock } from "~/components/ui/code-block";
import { Markdown } from "~/components/ui/markdown";
import { stepColor } from "~/lib/step-colors";
import { useTrajContext } from "~/lib/traj-context";
import type { NormalizedStep } from "~/lib/types";
import { cn } from "~/lib/utils";

function TrajLink({
  trajId,
  children,
  className,
}: {
  trajId: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = useTrajContext();
  if (!ctx) return <span className={className}>{children}</span>;
  return (
    <Link
      to={`/i/${encodeURIComponent(ctx.identityId)}/t/${encodeURIComponent(trajId)}`}
      className={cn("hover:underline", className)}
    >
      {children}
    </Link>
  );
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
}

function kb(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function OutputBlock({
  label,
  text,
  truncated,
  totalBytes,
  blobRef,
  expandAll,
  tint,
}: {
  label: string;
  text: string;
  truncated: boolean;
  totalBytes: number | null;
  blobRef: string | null;
  expandAll: boolean;
  tint?: string;
}) {
  if (!text && !truncated) return null;
  return (
    <div className={cn("rounded border bg-muted/30 px-2 py-1.5", tint)}>
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <ExpandableText text={text} expandAll={expandAll} mono />
      {truncated &&
        (blobRef ? (
          <BlobLoader blobRef={blobRef} totalBytes={totalBytes} />
        ) : (
          <div className="mt-1 text-[11px] text-muted-foreground">
            truncated{totalBytes != null && <> — {kb(totalBytes)} total</>}
          </div>
        ))}
    </div>
  );
}

function CollapsedBlock({
  summary,
  children,
  expandAll,
}: {
  summary: string;
  children: React.ReactNode;
  expandAll: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(expandAll), [expandAll]);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        {open ? "▾" : "▸"} {summary}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

export function StepContent({
  step,
  expandAll,
}: {
  step: NormalizedStep;
  expandAll: boolean;
}) {
  const raw = step.raw;

  switch (step.type) {
    case "reasoning": {
      const thought = str(raw.thought);
      const cmd = str(raw.cmd);
      return (
        <div className="space-y-1.5">
          {thought && <ExpandableText text={thought} expandAll={expandAll} />}
          {cmd && <CodeBlock code={cmd} lang="bash" wrap />}
        </div>
      );
    }
    case "shell-output": {
      const exit = raw.exit as number | null | undefined;
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            {exit != null && (
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[10px]",
                  exit === 0
                    ? "text-green-700 dark:text-green-400"
                    : "text-red-700 dark:text-red-400"
                )}
              >
                exit {exit}
              </Badge>
            )}
            {raw.timed_out === true && (
              <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400">
                timed out
              </Badge>
            )}
          </div>
          <OutputBlock
            label="stdout"
            text={str(raw.stdout)}
            truncated={raw.stdout_truncated === true}
            totalBytes={(raw.stdout_bytes as number) ?? null}
            blobRef={typeof raw.stdout_ref === "string" ? raw.stdout_ref : null}
            expandAll={expandAll}
          />
          <OutputBlock
            label="stderr"
            text={str(raw.stderr)}
            truncated={raw.stderr_truncated === true}
            totalBytes={(raw.stderr_bytes as number) ?? null}
            blobRef={typeof raw.stderr_ref === "string" ? raw.stderr_ref : null}
            expandAll={expandAll}
            tint="border-red-200 dark:border-red-900"
          />
          {str(raw.feedback) && (
            <ExpandableText text={str(raw.feedback)} expandAll={expandAll} className="text-amber-800 dark:text-amber-300" />
          )}
        </div>
      );
    }
    case "shellm-run": {
      const meta = [
        raw.model && `model ${str(raw.model)}`,
        raw.effort && `effort ${str(raw.effort)}`,
        (raw.env as { name?: string })?.name && `env ${(raw.env as { name?: string }).name}`,
        raw.resumed === true && "resumed",
      ].filter(Boolean) as string[];
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {meta.map((m) => (
              <Badge key={m} variant="outline" className="font-mono text-[10px] text-muted-foreground">
                {m}
              </Badge>
            ))}
          </div>
          <CollapsedBlock summary={`command (${str(raw.command).length} chars)`} expandAll={expandAll}>
            <CodeBlock code={str(raw.command)} lang="bash" wrap />
          </CollapsedBlock>
        </div>
      );
    }
    case "prompt":
      return (
        <CollapsedBlock summary={`prompt (${str(raw.content).length} chars)`} expandAll={expandAll}>
          <CodeBlock code={str(raw.content)} lang="text" wrap />
        </CollapsedBlock>
      );
    case "run-summary": {
      const full = str(raw.full_summary);
      return (
        <div className="space-y-1.5">
          <div className="text-sm font-medium">{str(raw.tldr)}</div>
          {full && (
            <CollapsedBlock summary="full summary" expandAll={expandAll}>
              <Markdown className="text-sm">{full}</Markdown>
            </CollapsedBlock>
          )}
        </div>
      );
    }
    case "final": {
      const thought = str(raw.thought);
      const cmd = str(raw.cmd);
      const content = str(raw.content);
      return (
        <div className="space-y-1.5">
          {thought && <ExpandableText text={thought} expandAll={expandAll} />}
          {cmd && <CodeBlock code={cmd} lang="bash" wrap />}
          {content && (
            <div className="rounded border bg-muted/30 px-2 py-1.5">
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                result
              </div>
              <ExpandableText text={content} expandAll={expandAll} />
            </div>
          )}
        </div>
      );
    }
    case "message": {
      const from = str(raw.from);
      const to = str(raw.to);
      return (
        <div className="space-y-1">
          {(from || to) && (
            <div className="font-mono text-[11px] text-muted-foreground">
              {from}
              {to && <> → {to}</>}
            </div>
          )}
          <ExpandableText text={str(raw.content)} expandAll={expandAll} />
        </div>
      );
    }
    case "fork": {
      const childId = step.fork?.child_traj_id ?? str(raw.child);
      const label = step.fork?.slug ?? childId;
      return (
        <div className="flex items-center gap-2 font-mono text-xs">
          <GitFork className="h-3.5 w-3.5 text-fuchsia-500" />
          {step.fork?.resolved ? (
            <TrajLink trajId={childId} className="truncate text-fuchsia-700 dark:text-fuchsia-300">
              {label} ↗
            </TrajLink>
          ) : (
            <span className="truncate" title="child trajectory not found on disk">
              {label} (unresolved)
            </span>
          )}
        </div>
      );
    }
    case "trajectory":
      return (
        <div className="font-mono text-xs text-muted-foreground">{step.preview}</div>
      );
    default: {
      const content = str(raw.content) || str(raw.thought);
      return (
        <div className="space-y-1">
          {step.writeback && (
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-fuchsia-600 dark:text-fuchsia-400">
              <Undo2 className="h-3 w-3" />
              <TrajLink trajId={step.writeback.from_traj}>
                returned from {step.writeback.from_traj.slice(0, 8)} ↗
              </TrajLink>
            </div>
          )}
          <ExpandableText text={content} expandAll={expandAll} />
        </div>
      );
    }
  }
}

export function StepCard({
  step,
  expandAll,
  highlighted = false,
}: {
  step: NormalizedStep;
  expandAll: boolean;
  highlighted?: boolean;
}) {
  const color = stepColor(step.type);
  return (
    <div
      id={`step-${step.step_id}`}
      className={cn(
        "border-l-2 py-2 pl-3 pr-2 transition-colors",
        color.border,
        highlighted && "bg-primary/10"
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 60px" }}
    >
      <StepHeader step={step} />
      <div className="mt-1.5">
        <StepContent step={step} expandAll={expandAll} />
      </div>
    </div>
  );
}
