import useCopilotChatStore from "../copilotChatStore";

describe("copilotChatStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useCopilotChatStore.setState({ agentId: "langflow", threadIds: {} });
  });

  it("keeps one thread per flow and persists it", () => {
    const { ensureThreadId } = useCopilotChatStore.getState();

    const first = ensureThreadId("flow-1");
    const again = ensureThreadId("flow-1");
    const other = ensureThreadId("flow-2");

    expect(first).toMatch(/^agentic_/);
    expect(again).toBe(first);
    expect(other).not.toBe(first);
    expect(
      JSON.parse(localStorage.getItem("langflow-copilot-threads")!),
    ).toEqual({ "flow-1": first, "flow-2": other });
  });

  it("starts a new thread for a flow", () => {
    const { ensureThreadId, startNewThread } = useCopilotChatStore.getState();
    const first = ensureThreadId("flow-1");

    const next = startNewThread("flow-1");

    expect(next).not.toBe(first);
    expect(useCopilotChatStore.getState().threadIds["flow-1"]).toBe(next);
  });

  it("remembers the chosen agent", () => {
    useCopilotChatStore.getState().setAgentId("chat");

    expect(useCopilotChatStore.getState().agentId).toBe("chat");
    expect(JSON.parse(localStorage.getItem("langflow-copilot-agent")!)).toBe(
      "chat",
    );
  });
});
