/**
 * Browser persistence for the CopilotKit assistant chat.
 *
 * The runtime keeps no thread history (``threadEndpoints.list`` is false), so
 * the transcript of each (agent, thread) pair lives in ``localStorage``, the
 * same place the previous panel kept its sessions. Every read and write is
 * guarded: storage can be absent (private windows) or full, and the chat must
 * keep working without it.
 */

const THREADS_KEY = "langflow-copilot-threads";
const AGENT_KEY = "langflow-copilot-agent";
const MESSAGES_PREFIX = "langflow-copilot-messages:";
const MESSAGES_INDEX_KEY = "langflow-copilot-messages-index";

/** Transcripts kept before the least recently saved one is dropped. */
export const MAX_STORED_THREADS = 30;
/** Messages kept per transcript; older ones fall off the front. */
export const MAX_STORED_MESSAGES = 200;

/** Assistant sessions start with this prefix so the Playground's session list skips them. */
const THREAD_PREFIX = "agentic_";

export function newThreadId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${THREAD_PREFIX}${uuid}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

/** The current thread of each flow, so reopening a flow resumes its chat. */
export function readThreadIds(): Record<string, string> {
  const value = readJson<unknown>(THREADS_KEY, {});
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function writeThreadIds(threadIds: Record<string, string>): void {
  writeJson(THREADS_KEY, threadIds);
}

export function readAgentId(): string | null {
  const value = readJson<unknown>(AGENT_KEY, null);
  return typeof value === "string" && value ? value : null;
}

export function writeAgentId(agentId: string): void {
  writeJson(AGENT_KEY, agentId);
}

function messagesKey(agentId: string, threadId: string): string {
  return `${MESSAGES_PREFIX}${agentId}:${threadId}`;
}

export function loadThreadMessages<T = unknown>(
  agentId: string,
  threadId: string,
): T[] {
  const value = readJson<unknown>(messagesKey(agentId, threadId), []);
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Save a transcript, newest last. Keeps at most ``MAX_STORED_THREADS``
 * transcripts, dropping the least recently saved; when storage is full, drops
 * the oldest transcripts until this one fits (or none are left to drop).
 */
export function saveThreadMessages(
  agentId: string,
  threadId: string,
  messages: readonly unknown[],
): void {
  const key = messagesKey(agentId, threadId);
  if (messages.length === 0) {
    removeKey(key);
    writeJson(
      MESSAGES_INDEX_KEY,
      readIndex().filter((k) => k !== key),
    );
    return;
  }
  const kept = messages.slice(-MAX_STORED_MESSAGES);
  const index = [...readIndex().filter((k) => k !== key), key];
  while (index.length > MAX_STORED_THREADS) {
    removeKey(index.shift() as string);
  }
  while (!writeJson(key, kept) && index.length > 1) {
    removeKey(index.shift() as string);
  }
  writeJson(MESSAGES_INDEX_KEY, index);
}

export function clearThreadMessages(agentId: string, threadId: string): void {
  saveThreadMessages(agentId, threadId, []);
}

function readIndex(): string[] {
  const value = readJson<unknown>(MESSAGES_INDEX_KEY, []);
  return Array.isArray(value)
    ? value.filter((k): k is string => typeof k === "string")
    : [];
}
