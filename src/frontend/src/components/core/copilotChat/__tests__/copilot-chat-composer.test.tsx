import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  __getMockAgent,
  __resetCopilotKitMock,
} from "@/__mocks__/@copilotkit/react-core-v2";
import useCopilotChatStore from "@/stores/copilotChatStore";
import useFlowStore from "@/stores/flowStore";
import type { AllNodeType } from "@/types/flow";
import { CopilotChatComposer } from "../components/copilot-chat-composer";
import { runSlashCommand } from "../helpers/run-slash-command";

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: () => null,
}));

function Harness({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <CopilotChatComposer
      value={value}
      onChange={setValue}
      onSubmitMessage={onSubmit}
    />
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByTestId("copilot-chat-textarea") as HTMLTextAreaElement;
}

function type(text: string) {
  fireEvent.change(textarea(), {
    target: { value: text, selectionStart: text.length },
  });
}

function press(key: string) {
  fireEvent.keyDown(textarea(), { key });
}

// jsdom has no layout; the popovers scroll their active option into view.
Element.prototype.scrollIntoView = jest.fn();

describe("runSlashCommand", () => {
  beforeEach(() => {
    localStorage.clear();
    useCopilotChatStore.setState({
      skipAll: false,
      historyLimit: null,
      iterationsLimit: null,
    });
  });

  it("toggles skip-all", () => {
    expect(runSlashCommand("/skip-all")).toMatch(/enabled/);
    expect(useCopilotChatStore.getState().skipAll).toBe(true);
    expect(runSlashCommand("/skip-all")).toMatch(/disabled/);
    expect(useCopilotChatStore.getState().skipAll).toBe(false);
  });

  it("sets and clears the history and iteration limits", () => {
    runSlashCommand("/history 5");
    runSlashCommand("/iterations 20");
    expect(useCopilotChatStore.getState()).toMatchObject({
      historyLimit: 5,
      iterationsLimit: 20,
    });

    runSlashCommand("/history off");
    expect(useCopilotChatStore.getState().historyLimit).toBeNull();
  });

  it("leaves prompts alone", () => {
    expect(runSlashCommand("/skip-all please")).toBeNull();
    expect(runSlashCommand("build a flow")).toBeNull();
  });
});

describe("CopilotChatComposer", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetCopilotKitMock();
    useCopilotChatStore.setState({
      agentId: "langflow",
      skipAll: false,
      historyLimit: null,
      iterationsLimit: null,
    });
    useFlowStore.setState({ nodes: [] });
  });

  it("sends a prompt", () => {
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);

    type("build a chatbot");
    press("Enter");

    expect(onSubmit).toHaveBeenCalledWith("build a chatbot");
  });

  it("runs a panel command locally instead of sending it", () => {
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);

    type("/history 7");
    act(() => press("Enter"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(useCopilotChatStore.getState().historyLimit).toBe(7);
    expect(
      __getMockAgent("langflow").messages.map((m) => [m.role, m.content]),
    ).toEqual([
      ["user", "/history 7"],
      ["assistant", "History limit set to 7 message(s) for this session."],
    ]);
    expect(textarea().value).toBe("");
  });

  it("completes a command from the slash menu instead of sending", () => {
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);

    type("/ski");
    expect(
      screen.getByTestId("assistant-slash-command-popover"),
    ).toBeInTheDocument();
    press("Enter");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea().value).toBe("/skip-all");
  });

  it("inserts a canvas component from the @ menu", () => {
    const node = {
      id: "ChatInput-1",
      type: "genericNode",
      position: { x: 0, y: 0 },
      data: {
        id: "ChatInput-1",
        type: "ChatInput",
        node: { display_name: "Chat Input" },
      },
    } as unknown as AllNodeType;
    useFlowStore.setState({ nodes: [node], setNodes: jest.fn() } as never);
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);

    type("connect @cha");
    expect(
      screen.getByTestId("assistant-mention-option-ChatInput-1"),
    ).toBeInTheDocument();
    press("Enter");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea().value).toBe("connect 'ChatInput-1'");
  });

  it("recalls the previous prompt with Up", () => {
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);
    type("first prompt");
    press("Enter");
    type("");

    press("ArrowUp");

    expect(textarea().value).toBe("first prompt");
  });

  it("caps the message at the server's limit", async () => {
    const { useUtilityStore } = await import("@/stores/utilityStore");
    useUtilityStore.setState({ assistantMaxMessageLength: 5 });
    render(<Harness onSubmit={jest.fn()} />);

    type("12345");

    expect(textarea()).toHaveAttribute("maxlength", "5");
    expect(screen.getByTestId("copilot-message-limit")).toBeInTheDocument();
  });
});
