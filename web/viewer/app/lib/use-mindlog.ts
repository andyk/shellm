import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchMindlog, pollWhileLive } from "~/lib/api";
import type { Mindlog, RunGroup } from "~/lib/types";

/** Delta runs replace their previous versions in place; new runs append.
 * Unchanged runs keep object identity (memo-friendly). */
function mergeRuns(prev: RunGroup[], delta: RunGroup[]): RunGroup[] {
  if (!delta.length) return prev;
  const changed = new Map(delta.map((run) => [run.run_id, run]));
  const merged = prev.map((run) => {
    const update = changed.get(run.run_id);
    if (update) changed.delete(run.run_id);
    return update ?? run;
  });
  for (const run of delta) {
    if (changed.has(run.run_id)) merged.push(run);
  }
  return merged;
}

/** Mind log with incremental polling: after the first full fetch, each poll
 * asks only for steps beyond what we already hold (?since=N) and appends
 * them; runs arrive as deltas too (only the ones new steps touched) and are
 * merged by id. Old step objects keep their identity, so memoized step
 * components skip re-rendering. A shrunken step_count (log reset/rewritten)
 * falls back to a full refetch. */
export function useMindlog(identityId: string, live: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["mindlog", identityId],
    queryFn: async (): Promise<Mindlog> => {
      const prev = queryClient.getQueryData<Mindlog>(["mindlog", identityId]);
      if (!prev || !prev.steps.length) return fetchMindlog(identityId);
      const delta = await fetchMindlog(identityId, prev.steps.length);
      if (delta.step_count < prev.steps.length) return fetchMindlog(identityId);
      if (!delta.steps.length && !delta.runs.length) {
        return { ...delta, steps: prev.steps, runs: prev.runs };
      }
      return {
        ...delta,
        steps: delta.steps.length ? [...prev.steps, ...delta.steps] : prev.steps,
        runs: mergeRuns(prev.runs, delta.runs),
      };
    },
    refetchInterval: pollWhileLive(live),
  });
}
