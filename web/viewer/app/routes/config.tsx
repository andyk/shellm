import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { IdentityTabs } from "~/components/identity-tabs";
import { useControlsEnabled } from "~/components/thinker-controls";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { LoadingDots } from "~/components/ui/loading-dots";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  deleteEnvVar,
  exportIdentityUrl,
  fetchIdentityEnv,
  fetchIdentityStatus,
  putEnvVar,
} from "~/lib/api";
import type { EnvEntry } from "~/lib/types";

export function meta() {
  return [{ title: "shellm · config" }];
}

function useEnvMutations(identityId: string) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["env", identityId] });
  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      putEnvVar(identityId, key, value),
    onSuccess: (entry) => {
      toast.success(`Saved ${entry.key}`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (key: string) => deleteEnvVar(identityId, key),
    onSuccess: (result) => {
      toast.success(`Removed ${result.key}`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return { save, remove };
}

function ValueDisplay({ entry }: { entry: EnvEntry }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      {entry.secret && (
        <KeyRound className="size-3 shrink-0 text-muted-foreground" />
      )}
      {entry.value || <span className="text-muted-foreground">(empty)</span>}
    </span>
  );
}

function EnvRow({
  identityId,
  entry,
}: {
  identityId: string;
  entry: EnvEntry;
}) {
  const controlsEnabled = useControlsEnabled();
  const { save, remove } = useEnvMutations(identityId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <TableRow>
      <TableCell className="font-mono text-xs font-medium">{entry.key}</TableCell>
      <TableCell>
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(
                { key: entry.key, value: draft },
                { onSuccess: () => setEditing(false) }
              );
            }}
          >
            <Input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                entry.secret ? "enter new value (replaces current)" : entry.value
              }
              className="h-8 flex-1 font-mono text-xs"
            />
            <Button type="submit" size="sm" disabled={save.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <ValueDisplay entry={entry} />
        )}
      </TableCell>
      <TableCell className="text-right">
        {controlsEnabled && !editing && (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title={`Edit ${entry.key}`}
              onClick={() => {
                setDraft(entry.secret ? "" : entry.value);
                setEditing(true);
              }}
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={`Remove ${entry.key}`}
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Remove ${entry.key} from this identity's .env?`))
                  remove.mutate(entry.key);
              }}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function AddVarForm({
  identityId,
  prefillKey,
  onDone,
}: {
  identityId: string;
  prefillKey: string;
  onDone: () => void;
}) {
  const { save } = useEnvMutations(identityId);
  const [key, setKey] = useState(prefillKey);
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!key.trim()) return;
        save.mutate(
          { key: key.trim(), value },
          {
            onSuccess: () => {
              setKey("");
              setValue("");
              onDone();
            },
          }
        );
      }}
    >
      <Input
        value={key}
        onChange={(event) => setKey(event.target.value)}
        placeholder="VARIABLE_NAME"
        pattern="[A-Za-z_][A-Za-z0-9_]*"
        title="letters, digits, underscores"
        className="h-8 w-56 font-mono text-xs"
      />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="value"
        className="h-8 flex-1 font-mono text-xs"
      />
      <Button type="submit" size="sm" disabled={save.isPending || !key.trim()}>
        <Plus className="size-3" />
        Add
      </Button>
    </form>
  );
}

function ExportSection({ identityId }: { identityId: string }) {
  const [soulOnly, setSoulOnly] = useState(false);
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
          export
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Snapshot this identity as a portable .tgz — import it on another
          shellm dash (or with `identity import`). Secrets (.env) and runtime
          state never leave the box.
        </span>
      </div>
      <div className="flex items-center gap-4 rounded-lg border p-3">
        <Button variant="outline" size="sm" asChild>
          <a href={exportIdentityUrl(identityId, soulOnly)} download>
            <Download className="size-3" />
            Download export
          </a>
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={soulOnly}
            onCheckedChange={(checked) => setSoulOnly(checked === true)}
          />
          soul only — skip trajectories (memories, thinkers, and skills; the
          import starts a fresh mind log)
        </label>
      </div>
    </section>
  );
}

export default function ConfigPage() {
  const { identityId = "" } = useParams();
  const controlsEnabled = useControlsEnabled();
  const [prefillKey, setPrefillKey] = useState("");

  const { data: status } = useQuery({
    queryKey: ["status", identityId],
    queryFn: () => fetchIdentityStatus(identityId),
    refetchInterval: 5000,
  });

  const { data: env, isLoading } = useQuery({
    queryKey: ["env", identityId],
    queryFn: () => fetchIdentityEnv(identityId),
  });

  if (isLoading || !env) {
    return (
      <div className="flex justify-center py-20">
        <LoadingDots />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4">
      <IdentityTabs
        identityId={identityId}
        live={status?.live ?? false}
        active="config"
      />
      <div className="mx-auto w-full max-w-4xl">

      <section className="mb-8">
        <div className="mb-2 flex items-baseline gap-3">
          <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            identity .env
          </h2>
          <span className="text-[11px] text-muted-foreground">{env.note}</span>
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-64">Variable</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {env.env.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    No identity-specific variables yet.
                  </TableCell>
                </TableRow>
              )}
              {env.env.map((entry) => (
                <EnvRow key={entry.key} identityId={identityId} entry={entry} />
              ))}
            </TableBody>
          </Table>
        </div>
        {controlsEnabled && (
          <div className="mt-3">
            <AddVarForm
              key={prefillKey}
              identityId={identityId}
              prefillKey={prefillKey}
              onDone={() => setPrefillKey("")}
            />
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-baseline gap-3">
          <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            inherited from serve root .env
          </h2>
          <span className="text-[11px] text-muted-foreground">
            Applies to every identity; add a variable above to override it here.
          </span>
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableBody>
              {env.inherited.length === 0 && (
                <TableRow>
                  <TableCell className="py-6 text-center text-sm text-muted-foreground">
                    No .env at the serve root.
                  </TableCell>
                </TableRow>
              )}
              {env.inherited.map((entry) => (
                <TableRow key={entry.key}>
                  <TableCell className="w-64 font-mono text-xs">
                    {entry.key}
                  </TableCell>
                  <TableCell>
                    <ValueDisplay entry={entry} />
                    {entry.overridden && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        overridden
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="w-24 text-right">
                    {controlsEnabled && !entry.overridden && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPrefillKey(entry.key)}
                      >
                        Override
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <ExportSection identityId={identityId} />
      </div>
    </div>
  );
}
