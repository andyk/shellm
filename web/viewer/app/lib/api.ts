import type {
  ChatLog,
  Config,
  ControlResult,
  DispatchEvent,
  Identity,
  IdentityStatus,
  KillallResult,
  LogInfo,
  LogTail,
  MemoryInfo,
  Mindlog,
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
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

export function fetchConfig(): Promise<Config> {
  return getJson("/api/config");
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
  names: string[] = []
): Promise<ControlResult> {
  return postJson(
    `/api/identities/${encodeURIComponent(identityId)}/thinkers/stop`,
    { names }
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

export const IN_PROGRESS_POLL_MS = 2000;

export function pollWhileLive(live: boolean | undefined): number | false {
  return live ? IN_PROGRESS_POLL_MS : false;
}
