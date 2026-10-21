import { create } from "zustand";
import {
  newThreadId,
  readAgentId,
  readThreadIds,
  writeAgentId,
  writeThreadIds,
} from "@/components/core/copilotChat/helpers/thread-storage";

export const DEFAULT_COPILOT_AGENT = "langflow";

/**
 * Which agent the assistant chat talks to and which thread each flow is on.
 *
 * Kept apart from ``assistantManagerStore`` (panel open state, canvas undo):
 * this is the chat's own conversation state, and both pieces persist to
 * ``localStorage`` so a reload lands back in the same conversation.
 */
interface CopilotChatState {
  agentId: string;
  setAgentId: (agentId: string) => void;
  /** Flow id → that flow's current thread id. */
  threadIds: Record<string, string>;
  /** The flow's current thread, minting (and persisting) one on first use. */
  ensureThreadId: (flowId: string) => string;
  /** Start a fresh thread for the flow and return its id. */
  startNewThread: (flowId: string) => string;
}

const useCopilotChatStore = create<CopilotChatState>((set, get) => ({
  agentId: readAgentId() ?? DEFAULT_COPILOT_AGENT,
  setAgentId: (agentId) => {
    writeAgentId(agentId);
    set({ agentId });
  },
  threadIds: readThreadIds(),
  ensureThreadId: (flowId) => {
    const existing = get().threadIds[flowId];
    if (existing) return existing;
    return get().startNewThread(flowId);
  },
  startNewThread: (flowId) => {
    const threadId = newThreadId();
    const threadIds = { ...get().threadIds, [flowId]: threadId };
    writeThreadIds(threadIds);
    set({ threadIds });
    return threadId;
  },
}));

export default useCopilotChatStore;
