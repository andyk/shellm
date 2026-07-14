import { Link, useParams } from "react-router";

import { LiveBadge } from "~/components/live-badge";
import { cn } from "~/lib/utils";

const TABS = [
  { key: "timeline", label: "Timeline", path: "" },
  { key: "mindlog", label: "Mind log", path: "/mindlog" },
  { key: "thinkers", label: "Thinkers", path: "/thinkers" },
  { key: "chat", label: "Chat", path: "/chat" },
  { key: "memories", label: "Memories", path: "/memories" },
] as const;

/** Header row shared by the identity sub-pages: breadcrumb + tab links. */
export function IdentityTabs({
  identityId,
  live,
  active,
  name,
}: {
  identityId: string;
  live: boolean;
  active: (typeof TABS)[number]["key"];
  name?: string;
}) {
  useParams(); // keep router context
  const base = `/i/${encodeURIComponent(identityId)}`;
  const displayName = name ?? identityId.split("~").pop() ?? identityId;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        identities
      </Link>
      <span className="text-muted-foreground">/</span>
      <h1 className="font-mono text-lg font-semibold">{displayName}</h1>
      {live && <LiveBadge />}
      <nav className="ml-auto flex items-center gap-1 rounded-lg border p-0.5">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            to={`${base}${tab.path}`}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              tab.key === active
                ? "bg-accent font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
