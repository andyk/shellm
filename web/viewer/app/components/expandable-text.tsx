import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

const PREVIEW_LINES = 6;

/**
 * Text block clamped to a few lines with a toggle when it overflows.
 * Measure overflow with a ResizeObserver, sync with a global
 * expand-all switch.
 */
export function ExpandableText({
  text,
  expandAll,
  mono = false,
  className,
}: {
  text: string;
  expandAll: boolean;
  mono?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [canToggle, setCanToggle] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => setExpanded(expandAll), [expandAll]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
      setCanToggle(el.scrollHeight > lineHeight * (PREVIEW_LINES + 0.5));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className={className}>
      <div
        ref={contentRef}
        className={cn(
          "whitespace-pre-wrap break-words text-sm",
          mono && "font-mono text-xs",
          !expanded && "line-clamp-6"
        )}
      >
        {text}
      </div>
      {canToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {expanded ? "show less" : "show more"}
        </button>
      )}
    </div>
  );
}
