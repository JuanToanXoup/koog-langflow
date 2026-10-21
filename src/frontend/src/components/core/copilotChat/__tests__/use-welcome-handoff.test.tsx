import { renderHook } from "@testing-library/react";
import {
  __getMockAgent,
  __resetCopilotKitMock,
  mockCopilotKit,
} from "@/__mocks__/@copilotkit/react-core-v2";
import useCopilotChatStore from "@/stores/copilotChatStore";
import useFlowBuilderWelcomeStore from "@/stores/flowBuilderWelcomeStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { useWelcomeHandoff } from "../hooks/use-welcome-handoff";

const WELCOME_MODEL = {
  id: "Anthropic-claude-opus-5-5",
  name: "claude-opus-5-5",
  provider: "Anthropic",
  displayName: "claude-opus-5-5",
};

describe("useWelcomeHandoff", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetCopilotKitMock();
    useFlowsManagerStore.setState({ currentFlowId: "flow-1" });
    useCopilotChatStore.setState({
      agentId: "chat",
      selectedModel: null,
      historyLimit: null,
      iterationsLimit: 30,
    });
    useFlowBuilderWelcomeStore.setState({ pendingMessage: "build a RAG flow" });
  });

  it("sends the welcome prompt to the Langflow Assistant once", () => {
    localStorage.setItem(
      "langflow-assistant-selected-model",
      JSON.stringify(WELCOME_MODEL),
    );

    const { rerender } = renderHook(() =>
      useWelcomeHandoff({ isOpen: true, threadId: "agentic_t1" }),
    );
    rerender();

    const agent = __getMockAgent("langflow");
    expect(agent.threadId).toBe("agentic_t1");
    expect(agent.messages).toEqual([
      expect.objectContaining({ role: "user", content: "build a RAG flow" }),
    ]);
    expect(mockCopilotKit.runAgent).toHaveBeenCalledTimes(1);
    expect(mockCopilotKit.runAgent).toHaveBeenCalledWith({
      agent,
      forwardedProps: {
        flow_id: "flow-1",
        provider: "Anthropic",
        model_name: "claude-opus-5-5",
        iterations_limit: 30,
      },
    });
    expect(useCopilotChatStore.getState()).toMatchObject({
      agentId: "langflow",
      selectedModel: WELCOME_MODEL,
    });
    expect(useFlowBuilderWelcomeStore.getState().pendingMessage).toBeNull();
  });

  it("waits until the panel is open", () => {
    renderHook(() =>
      useWelcomeHandoff({ isOpen: false, threadId: "agentic_t1" }),
    );

    expect(mockCopilotKit.runAgent).not.toHaveBeenCalled();
    expect(useFlowBuilderWelcomeStore.getState().pendingMessage).toBe(
      "build a RAG flow",
    );
  });

  it("does nothing without a pending prompt", () => {
    useFlowBuilderWelcomeStore.setState({ pendingMessage: null });

    renderHook(() =>
      useWelcomeHandoff({ isOpen: true, threadId: "agentic_t1" }),
    );

    expect(mockCopilotKit.runAgent).not.toHaveBeenCalled();
  });
});
