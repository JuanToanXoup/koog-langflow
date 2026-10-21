import { create } from "zustand";
import type { AssistantModel } from "@/components/core/assistantPanel/assistant-panel.types";
import {
  readHistoryLimit,
  writeHistoryLimit,
} from "@/components/core/copilotChat/helpers/history-storage";
import {
  readIterationsLimit,
  writeIterationsLimit,
} from "@/components/core/copilotChat/helpers/iterations-storage";
import {
  readSkipAll,
  writeSkipAll,
} from "@/components/core/copilotChat/helpers/skip-all-storage";
import {
  newThreadId,
  readAgentId,
  readSelectedModel,
  readThreadIds,
  writeAgentId,
  writeSelectedModel,
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
  /** The model both agents run on; sent as ``forwardedProps.provider``/``model_name``. */
  selectedModel: AssistantModel | null;
  setSelectedModel: (model: AssistantModel | null) => void;
  /** ``/history N``: past messages the assistant remembers; null = server default. */
  historyLimit: number | null;
  setHistoryLimit: (limit: number | null) => void;
  /** ``/iterations N``: the assistant's step budget per request; null = server default. */
  iterationsLimit: number | null;
  setIterationsLimit: (limit: number | null) => void;
  /** ``/skip-all``: plans and flow proposals are accepted without a click. */
  skipAll: boolean;
  setSkipAll: (skipAll: boolean) => void;
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
  selectedModel: readSelectedModel(),
  setSelectedModel: (selectedModel) => {
    if (selectedModel) writeSelectedModel(selectedModel);
    set({ selectedModel });
  },
  historyLimit: readHistoryLimit(),
  setHistoryLimit: (historyLimit) => {
    writeHistoryLimit(historyLimit);
    set({ historyLimit });
  },
  iterationsLimit: readIterationsLimit(),
  setIterationsLimit: (iterationsLimit) => {
    writeIterationsLimit(iterationsLimit);
    set({ iterationsLimit });
  },
  skipAll: readSkipAll(),
  setSkipAll: (skipAll) => {
    writeSkipAll(skipAll);
    set({ skipAll });
  },
}));

export default useCopilotChatStore;
