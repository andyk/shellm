import { Bot, Cog, Cpu } from "lucide-react";
import { toast } from "sonner";

import { stepColor } from "~/lib/step-colors";
import type { NormalizedStep } from "~/lib/types";

function timeOf(ts: string): string {
  return ts.length >= 19 ? ts.slice(11, 19) : ts;
}

function Chip({
  children,
  title,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${className} ${
        onClick ? "cursor-pointer hover:opacity-75" : "cursor-default"
      }`}
    >
      {children}
    </button>
  );
}

export function StepHeader({ step }: { step: NormalizedStep }) {
  const color = stepColor(step.type);
  const copyId = () => {
    navigator.clipboard.writeText(step.step_id);
    toast.success("Copied step id");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono">
      <Chip
        title={step.ts}
        onClick={() => {
          navigator.clipboard.writeText(step.ts);
          toast.success("Copied timestamp");
        }}
        className="tabular-nums text-muted-foreground"
      >
        {timeOf(step.ts)}
      </Chip>
      <Chip className={color.chip} onClick={copyId} title={`step ${step.step_id} — click to copy`}>
        {step.type}
      </Chip>
      {step.source ? (
        <Chip className="bg-muted text-muted-foreground" title={`written by ${step.source}`}>
          <Bot className="h-2.5 w-2.5" />
          {step.source}
        </Chip>
      ) : (
        <Chip className="text-muted-foreground/60" title="shellm machinery step">
          <Cog className="h-2.5 w-2.5" />
        </Chip>
      )}
      {typeof step.raw.model === "string" && step.raw.model && step.type !== "shellm-run" && (
        <Chip className="text-muted-foreground/60" title={`model ${step.raw.model}`}>
          <Cpu className="h-2.5 w-2.5" />
          {step.raw.model}
        </Chip>
      )}
    </div>
  );
}
