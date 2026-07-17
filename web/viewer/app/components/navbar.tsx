import { useQuery } from "@tanstack/react-query";
import { Moon, RefreshCw, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { useControlsEnabled } from "~/components/thinker-controls";
import { Button } from "~/components/ui/button";
import { API_BASE, fetchConfig, selfUpdate } from "~/lib/api";
import type { Config } from "~/lib/types";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8 w-8" />;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}

/** Wait through the restart: poll /api/config until the commit changes,
 * then reload the page (which also picks up the rebuilt frontend). */
function pollForNewBuild(oldCommit: string, timeoutMs = 5 * 60 * 1000) {
  const started = Date.now();
  const tick = async () => {
    if (Date.now() - started > timeoutMs) {
      toast.error("Update timed out — check `journalctl -u shellm-web` on the box");
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/config`);
      if (response.ok) {
        const config = (await response.json()) as Config;
        if (config.git_commit && config.git_commit !== oldCommit) {
          window.location.reload();
          return;
        }
      }
    } catch {
      // server is restarting/rebuilding — keep waiting
    }
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
}

/** The build stamp doubles as a meta menu: click for server details and —
 * when the server allows it — a "pull latest & restart" control. */
function BuildMenu({ config }: { config: Config }) {
  const controlsEnabled = useControlsEnabled();
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const runUpdate = async () => {
    setUpdating(true);
    try {
      const result = await selfUpdate();
      if (!result.updated) {
        toast.info(`Already up to date (${result.commit})`);
        setUpdating(false);
        return;
      }
      toast.success(
        `Updating ${result.from_commit} → ${result.to_commit} — restarting, page reloads when it's back (~1-2 min)`
      );
      pollForNewBuild(config.git_commit ?? "");
    } catch (error) {
      toast.error((error as Error).message);
      setUpdating(false);
    }
  };

  return (
    <div className="relative">
      <button
        className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
        title="Build info"
        onClick={() => setOpen(!open)}
      >
        {config.git_commit}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-72 space-y-2 rounded-md border bg-background p-3 text-xs shadow-md">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
              <span className="text-muted-foreground">commit</span>
              <span>
                {config.git_commit}
                {config.git_branch ? ` (${config.git_branch})` : ""}
              </span>
              <span className="text-muted-foreground">version</span>
              <span>{config.version}</span>
              <span className="text-muted-foreground">root</span>
              <span className="break-all">{config.root}</span>
            </div>
            {config.self_update_enabled && controlsEnabled && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={updating}
                onClick={runUpdate}
              >
                <RefreshCw className={`size-3 ${updating ? "animate-spin" : ""}`} />
                {updating ? "Updating…" : "Pull latest & restart"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function Navbar() {
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: fetchConfig,
    staleTime: Infinity,
  });
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="flex h-12 items-center justify-between px-4">
        <Link to="/" className="font-mono text-sm font-semibold tracking-tight">
          shellm
        </Link>
        <div className="flex items-center gap-3">
          {config?.git_commit && <BuildMenu config={config} />}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
