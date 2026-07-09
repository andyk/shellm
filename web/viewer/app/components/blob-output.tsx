import { useState } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { API_BASE } from "~/lib/api";
import { useTrajContext } from "~/lib/traj-context";

function kb(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

/**
 * "Load full output" affordance for blob-spilled stdout/stderr.
 * The step keeps a 4 KB inline head; the full bytes live in blobs/<ref>.
 */
export function BlobLoader({
  blobRef,
  totalBytes,
}: {
  blobRef: string; // e.g. "blobs/<step_id>-000000.stdout"
  totalBytes: number | null;
}) {
  const ctx = useTrajContext();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = blobRef.split("/").pop() ?? blobRef;
  if (!ctx) {
    return (
      <div className="mt-1 text-[11px] text-muted-foreground">
        truncated{totalBytes != null && <> — {kb(totalBytes)} total</>}
      </div>
    );
  }

  const url = `${API_BASE}/api/identities/${encodeURIComponent(ctx.identityId)}/traj/${encodeURIComponent(ctx.trajId)}/blob/${encodeURIComponent(name)}`;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      setContent(await response.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (content !== null) {
    return (
      <div className="mt-1.5">
        <ScrollArea className="max-h-96 overflow-auto rounded border bg-muted/40">
          <pre className="whitespace-pre-wrap break-words p-2 font-mono text-[11px]">
            {content}
          </pre>
        </ScrollArea>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-[11px] text-muted-foreground hover:underline"
        >
          open raw ↗
        </a>
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>truncated{totalBytes != null && <> — {kb(totalBytes)} total</>}</span>
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="text-foreground/80 underline-offset-2 hover:underline disabled:opacity-50"
      >
        {loading ? "loading…" : "load full output"}
      </button>
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
