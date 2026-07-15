import { useQuery } from "@tanstack/react-query";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { fetchConfig } from "~/lib/api";

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

export function Navbar() {
  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: fetchConfig,
    staleTime: Infinity,
  });
  const build = config?.git_commit
    ? `${config.git_commit}${config.git_branch ? ` (${config.git_branch})` : ""}`
    : undefined;
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="flex h-12 items-center justify-between px-4">
        <Link
          to="/"
          className="font-mono text-sm font-semibold tracking-tight"
          title={build ? `running ${build}` : undefined}
        >
          shellm
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
