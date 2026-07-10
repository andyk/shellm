import { Badge } from "~/components/ui/badge";

export function LiveBadge() {
  return (
    <Badge className="gap-1.5 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      live
    </Badge>
  );
}
