import { act, render, renderHook, screen } from "@testing-library/react";
import {
  __getMockAgent,
  __resetCopilotKitMock,
} from "@/__mocks__/@copilotkit/react-core-v2";
import {
  AssistantProgress,
  useAssistantRunState,
} from "../components/assistant-progress";

describe("assistant progress", () => {
  beforeEach(() => __resetCopilotKitMock());

  it("follows a run through its progress and tool events", () => {
    const agent = __getMockAgent("langflow");
    const { result } = renderHook(() => useAssistantRunState(agent));

    act(() => agent.setRunning(true));
    act(() =>
      agent.emitCustomEvent("langflow.progress", {
        step: "generating",
        message: "Generating response...",
      }),
    );
    expect(result.current).toMatchObject({
      running: true,
      message: "Generating response...",
    });

    act(() =>
      agent.emitCustomEvent("langflow.tool_start", {
        tool: "add_component",
        label: "Adding ChatInput",
      }),
    );
    render(<AssistantProgress state={result.current} />);
    expect(screen.getByRole("status")).toHaveTextContent("Adding ChatInput");

    act(() => agent.setRunning(false));
    expect(result.current.running).toBe(false);
  });

  it("renders nothing while idle", () => {
    const { container } = render(
      <AssistantProgress state={{ running: false }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
