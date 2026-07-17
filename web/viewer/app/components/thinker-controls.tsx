import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  fetchConfig,
  startThinkers,
  stopThinkers,
  stepThinker,
} from "~/lib/api";
import type { ControlResult } from "~/lib/types";

/** True when the server allows mutations (read-only deployments hide controls). */
export function useControlsEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["config"],
    queryFn: fetchConfig,
    staleTime: Infinity,
  });
  return data?.controls_enabled ?? false;
}

export function useThinkerMutation(identityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      names,
      force,
    }: {
      action: "start" | "stop" | "step";
      names: string[];
      force?: boolean;
    }): Promise<ControlResult> => {
      if (action === "step") return stepThinker(identityId, names[0]);
      if (action === "start") return startThinkers(identityId, names);
      return stopThinkers(identityId, names, force ?? false);
    },
    onSuccess: (result) => {
      const target = result.names.length ? result.names.join(", ") : "all thinkers";
      if (result.action === "step") {
        toast.success(`Triggered ${target} — output lands in its log`);
      } else {
        // The CLI reports progress on stderr; last line is the most useful.
        const lines = (result.stderr ?? "").split("\n").filter(Boolean);
        toast.success(
          `${result.action === "start" ? "Started" : "Stopped"} ${target}`,
          { description: lines[lines.length - 1] }
        );
      }
      for (const key of ["thinkers", "status", "logs", "dispatch", "chat"]) {
        queryClient.invalidateQueries({ queryKey: [key, identityId] });
      }
      queryClient.invalidateQueries({ queryKey: ["identities"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/** Start/stop pair for one thinker (names=[name]) or the whole identity (names=[]). */
export function StartStopButtons({
  identityId,
  names,
  running,
  startDisabled,
  startDisabledReason,
}: {
  identityId: string;
  names: string[];
  running: boolean;
  startDisabled?: boolean;
  startDisabledReason?: string;
}) {
  const enabled = useControlsEnabled();
  const mutation = useThinkerMutation(identityId);
  if (!enabled) return null;

  const isAll = names.length === 0;
  const label = isAll ? "all" : names.join(", ");

  if (running) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        title="Drain stop: no new triggers, in-flight steps finish (shift-click: kill in-flight steps immediately)"
        onClick={(event) => {
          const force = event.shiftKey;
          if (
            isAll &&
            !window.confirm(
              force
                ? "Force-stop all thinkers? In-flight steps will be killed."
                : "Stop all thinkers? In-flight steps finish, then everything goes quiet."
            )
          ) {
            return;
          }
          mutation.mutate({ action: "stop", names, force });
        }}
      >
        <Square className="size-3" />
        {isAll ? "Stop all" : "Stop"}
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={mutation.isPending || startDisabled}
      title={startDisabled ? startDisabledReason : `Start ${label}`}
      onClick={() => mutation.mutate({ action: "start", names })}
    >
      <Play className="size-3" />
      {isAll ? "Start all" : "Start"}
    </Button>
  );
}
