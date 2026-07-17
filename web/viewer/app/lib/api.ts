import type {
  ChatLog,
  Config,
  ControlResult,
  DispatchEvent,
  EnvEntry,
  Identity,
  IdentityEnv,
  ImportResult,
  IdentityStatus,
  KillallResult,
  LogInfo,
  LogTail,
  MemoryInfo,
  Mindlog,
  Recap,
  SelfUpdateResult,
  SubTrajectory,
  ThinkersStatus,
  TreeNode,
} from "~/lib/types";

export const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function sendJson<T>(
  method: string,
  path: string,
  body: unknown
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    // Control endpoints put the CLI's message in detail.message; plain
    // FastAPI errors put a string in detail.
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (typeof data?.detail === "string") message = data.detail;
      else if (data?.detail?.message) message = data.detail.message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return sendJson("POST", path, body ?? {});
}

export function fetchConfig(): Promise<Config> {
  return getJson("/api/config");
}

export function selfUpdate(): Promise<SelfUpdateResult> {
  return postJson("/api/update", {});
}

export function fetchIdentities(): Promise<Identity[]> {
  return getJson("/api/identities");
}

export function fetchIdentityStatus(identityId: string): Promise<IdentityStatus> {
  return getJson(`/api/identities/${encodeURIComponent(identityId)}/status`);
}

export function fetchMindlog(identityId: string): Promise<Mindlog> {
  return getJson(`/api/identities/${encodeURIComponent(identityId)}/mindlog`);
}

export function fetchTree(
  identityId: string,
  node?: string,
  depth = 2
): Promise<TreeNode> {
  const params = new URLSearchParams({ depth: String(depth) });
  if (node) params.set("node", node);
  return getJson(
    `/api/identities/${encodeURIComponent(identityId)}/tree?${params}`
  );
}

export function fetchSubTraj(
  identityId: string,
  trajId: string
): Promise<SubTrajectory> {
  return getJson(
    `/api/identities/${encodeURIComponent(identityId)}/traj/${encodeURIComponent(trajId)}`
  );
}

export function fetchLogs(identityId: string): Promise<LogInfo[]> {
  return getJson(`/api/identities/${encodeURIComponent(identityId)}/logs`);
}

export function fetchLog(
  identityId: string,
  name: string,
  tailBytes = 65536
): Promise<LogTail> {
  return getJson(
    `/api/identities/${encodeURIComponent(identityId)}/logs/${encodeURIComponent(name)}?tail_bytes=${tailBytes}`
  );
}

export function fetchDispatch(identityId: string): Promise<DispatchEvent[]> {
  return getJson(`/api/identities/${encodeURIComponent(identityId)}/dispatch`);
}

export function fetchMemories(identityId: string): Promise<MemoryInfo[]> {
  return getJson(`/api/identities/${encodeURIComponent(identityId)}/memories`);
}

export function fetchMemory(
  identityId: string,
  name: string
): Promise<{ name: string; content: string }> {
  return getJson(
    `/api/identities/${encodeURIComponent(identityId)}/memories/${encodeURIComponent(name)}`
  );
}

export function fetchRecap(identityId: string): Promise<Recap> {
  return getJson(`/api/identities/${encodeURIComponent(identityId)}/recap`);
}

export function refreshRecap(
  identityId: string,
  rebuild = false
): Promise<{ ok: boolean }> {
  return postJson(`/api/identities/${encodeURIComponent(identityId)}/recap/refresh`, {
    rebuild,
  });
}

export function fetchThinkers(identityId: string): Promise<ThinkersStatus> {
  return getJson(`/api/identities/${encodeURIComponent(identityId)}/thinkers`);
}

export function startThinkers(
  identityId: string,
  names: string[] = []
): Promise<ControlResult> {
  return postJson(
    `/api/identities/${encodeURIComponent(identityId)}/thinkers/start`,
    { names }
  );
}

export function stopThinkers(
  identityId: string,
  names: string[] = [],
  force = false
): Promise<ControlResult> {
  return postJson(
    `/api/identities/${encodeURIComponent(identityId)}/thinkers/stop`,
    { names, force }
  );
}

export function stepThinker(
  identityId: string,
  name: string
): Promise<ControlResult> {
  return postJson(
    `/api/identities/${encodeURIComponent(identityId)}/thinkers/${encodeURIComponent(name)}/step`,
    {}
  );
}

export function setThinkerEnabled(
  identityId: string,
  name: string,
  enabled: boolean
): Promise<{ ok: boolean; name: string; disabled: boolean; needs_restart?: boolean }> {
  return postJson(
    `/api/identities/${encodeURIComponent(identityId)}/thinkers/${encodeURIComponent(name)}/${enabled ? "enable" : "disable"}`,
    {}
  );
}

export function fetchChat(identityId: string, tail = 200): Promise<ChatLog> {
  return getJson(
    `/api/identities/${encodeURIComponent(identityId)}/chat?tail=${tail}`
  );
}

export function sendChat(
  identityId: string,
  content: string,
  fromName: string
): Promise<{ ok: boolean; from: string; to: string }> {
  return postJson(`/api/identities/${encodeURIComponent(identityId)}/chat`, {
    content,
    from_name: fromName,
  });
}

export function createIdentity(name: string): Promise<{ id: string; name: string }> {
  return postJson("/api/identities", { name });
}

export function killAll(dryRun: boolean): Promise<KillallResult> {
  return postJson("/api/killall", { dry_run: dryRun });
}

// Export endpoints are plain downloads — link to them, don't fetch.
export function exportIdentityUrl(identityId: string, soulOnly = false): string {
  const suffix = soulOnly ? "?soul_only=true" : "";
  return `${API_BASE}/api/identities/${encodeURIComponent(identityId)}/export${suffix}`;
}

export function exportAllUrl(): string {
  return `${API_BASE}/api/export`;
}

export async function importIdentities(
  file: File,
  name?: string
): Promise<ImportResult> {
  const suffix = name ? `?name=${encodeURIComponent(name)}` : "";
  const response = await fetch(`${API_BASE}/api/identities/import${suffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/gzip" },
    body: file,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (typeof data?.detail === "string") message = data.detail;
      else if (data?.detail?.message) message = data.detail.message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  return response.json() as Promise<ImportResult>;
}

export function fetchIdentityEnv(identityId: string): Promise<IdentityEnv> {
  return getJson(`/api/identities/${encodeURIComponent(identityId)}/env`);
}

export function putEnvVar(
  identityId: string,
  key: string,
  value: string
): Promise<EnvEntry> {
  return sendJson(
    "PUT",
    `/api/identities/${encodeURIComponent(identityId)}/env`,
    { key, value }
  );
}

export function deleteEnvVar(
  identityId: string,
  key: string
): Promise<{ ok: boolean; key: string }> {
  return sendJson(
    "DELETE",
    `/api/identities/${encodeURIComponent(identityId)}/env/${encodeURIComponent(key)}`,
    undefined
  );
}

export const IN_PROGRESS_POLL_MS = 2000;

export function pollWhileLive(live: boolean | undefined): number | false {
  return live ? IN_PROGRESS_POLL_MS : false;
}
