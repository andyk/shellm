import type {
  Config,
  DispatchEvent,
  Identity,
  IdentityStatus,
  LogInfo,
  LogTail,
  MemoryInfo,
  Mindlog,
  SubTrajectory,
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

export const IN_PROGRESS_POLL_MS = 2000;

export function pollWhileLive(live: boolean | undefined): number | false {
  return live ? IN_PROGRESS_POLL_MS : false;
}
