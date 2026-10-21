import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { useEffect } from "react";
import useCopilotChatStore from "@/stores/copilotChatStore";
import useFlowBuilderWelcomeStore from "@/stores/flowBuilderWelcomeStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import {
  loadThreadMessages,
  readSelectedModel,
} from "../helpers/thread-storage";
import { LANGFLOW_AGENT_ID } from "../tools/tool-answer";
import { forwardedPropsFrom } from "./use-forwarded-props";

function newMessageId(): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Send the prompt typed on the new-flow welcome screen as the first message to
 * the Langflow Assistant once the panel opens, then drop it so it never replays.
 */
export function useWelcomeHandoff({
  isOpen,
  threadId,
}: {
  isOpen: boolean;
  threadId?: string;
}) {
  const pendingMessage = useFlowBuilderWelcomeStore(
    (state) => state.pendingMessage,
  );
  const clearPendingMessage = useFlowBuilderWelcomeStore(
    (state) => state.clearPendingMessage,
  );
  const { agent, isReady } = useAgent({ agentId: LANGFLOW_AGENT_ID });
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    if (!isOpen || !pendingMessage || !isReady || !threadId) return;
    clearPendingMessage();

    const store = useCopilotChatStore.getState();
    // The welcome screen has its own model picker; its choice runs this message.
    const model = readSelectedModel() ?? store.selectedModel;
    if (model) store.setSelectedModel(model);
    store.setAgentId(LANGFLOW_AGENT_ID);
    if (agent.threadId !== threadId) {
      // The panel was on another agent: bind the assistant to this flow's thread.
      agent.threadId = threadId;
      agent.setMessages(loadThreadMessages(LANGFLOW_AGENT_ID, threadId));
    }

    agent.addMessage({
      id: newMessageId(),
      role: "user",
      content: pendingMessage,
    });
    void copilotkit.runAgent({
      agent,
      // The provider's properties catch up a render later; pass them now.
      forwardedProps: forwardedPropsFrom({
        flowId: useFlowsManagerStore.getState().currentFlowId,
        model,
        historyLimit: store.historyLimit,
        iterationsLimit: store.iterationsLimit,
      }),
    });
  }, [
    isOpen,
    pendingMessage,
    isReady,
    threadId,
    agent,
    copilotkit,
    clearPendingMessage,
  ]);
}
