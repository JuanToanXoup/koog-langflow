import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  __getMockAgent,
  __lastProps,
  __resetCopilotKitMock,
  mockCopilotKit,
} from "@/__mocks__/@copilotkit/react-core-v2";
import useCopilotChatStore from "@/stores/copilotChatStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { useUtilityStore } from "@/stores/utilityStore";
import { axe } from "@/utils/a11y-test";
import { CopilotChatPanel } from "../copilot-chat-panel";

const mockApiGet = jest.fn();
jest.mock("@/controllers/API/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

let mockReadOnly = false;
jest.mock("@/contexts/permissionsContext", () => ({
  useIsFlowReadOnly: () => mockReadOnly,
}));

jest.mock("@/assets/langflow_assistant.svg", () => "mock-assistant-icon.svg");

// The cards pull in the code viewer's ESM-only highlighter; they have their own tests.
jest.mock("../tools/use-canvas-tools", () => ({ useCanvasTools: jest.fn() }));
jest.mock("../components/copilot-model-picker", () => ({
  CopilotModelPicker: () => null,
}));

jest.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ open: false }),
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => (
    <span aria-hidden="true">{name}</span>
  ),
}));

const RUNTIME_INFO = {
  version: "1.79.1",
  agents: {
    langflow: {
      name: "Langflow Assistant",
      description: "Builds and edits the open flow.",
      className: "LangflowAssistantAgent",
    },
    chat: {
      name: "Chat",
      description: "Chat with your default model.",
      className: "ModelChatAgent",
    },
  },
};

function renderPanel(props: { isOpen?: boolean; onClose?: () => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onClose = props.onClose ?? jest.fn();
  const utils = render(
    <CopilotChatPanel isOpen={props.isOpen ?? true} onClose={onClose} />,
    { wrapper },
  );
  return { ...utils, onClose };
}

describe("CopilotChatPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetCopilotKitMock();
    mockReadOnly = false;
    mockApiGet.mockResolvedValue({ data: RUNTIME_INFO });
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as never;
    useFlowsManagerStore.setState({ currentFlowId: "flow-1" });
    useUtilityStore.setState({
      copilotkitChatEnabled: true,
      agenticExperienceEnabled: true,
    });
    useCopilotChatStore.setState({ agentId: "langflow", threadIds: {} });
  });

  it("hosts the CopilotKit chat on the flow's thread", async () => {
    renderPanel();

    expect(await screen.findByTestId("copilot-chat")).toHaveAttribute(
      "data-agent-id",
      "langflow",
    );
    const threadId = useCopilotChatStore.getState().threadIds["flow-1"];
    expect(threadId).toMatch(/^agentic_/);
    expect(__lastProps.configuration).toMatchObject({
      agentId: "langflow",
      threadId,
      hasExplicitThreadId: false,
    });
    expect(screen.getByTestId("assistant-panel")).toHaveAttribute(
      "role",
      "complementary",
    );
  });

  it("lists the runtime's agents and switches between them", async () => {
    const user = userEvent.setup();
    renderPanel();

    const picker = await screen.findByTestId("copilot-agent-picker");
    await waitFor(() => expect(picker).toHaveTextContent("Langflow Assistant"));
    expect(mockApiGet).toHaveBeenCalledWith("/api/v1/copilotkit/info");

    await user.click(picker);
    expect(
      await screen.findByTestId("copilot-agent-option-langflow"),
    ).toHaveTextContent("Builds and edits the open flow.");
    await user.click(screen.getByTestId("copilot-agent-option-chat"));

    expect(useCopilotChatStore.getState().agentId).toBe("chat");
    expect(screen.getByTestId("copilot-chat")).toHaveAttribute(
      "data-agent-id",
      "chat",
    );
  });

  it("falls back to the default agent when the remembered one is gone", async () => {
    useCopilotChatStore.setState({ agentId: "retired-agent" });
    renderPanel();

    await waitFor(() =>
      expect(useCopilotChatStore.getState().agentId).toBe("langflow"),
    );
  });

  it("starts a new session on a fresh thread", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByTestId("copilot-chat");
    const newSession = screen.getByTestId("assistant-new-session");
    expect(newSession).toBeDisabled();

    const firstThread = useCopilotChatStore.getState().threadIds["flow-1"];
    act(() =>
      __getMockAgent("langflow").addMessage({
        id: "m1",
        role: "user",
        content: "hi",
      }),
    );
    await waitFor(() => expect(newSession).toBeEnabled());
    await user.click(newSession);

    const nextThread = useCopilotChatStore.getState().threadIds["flow-1"];
    expect(nextThread).not.toBe(firstThread);
    expect(__lastProps.configuration).toMatchObject({ threadId: nextThread });
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/v1/agentic/sessions/reset?session_id=${nextThread}`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("stops a running reply before starting a new session", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByTestId("copilot-chat");
    const agent = __getMockAgent("langflow");
    act(() => {
      agent.addMessage({ id: "m1", role: "user", content: "hi" });
      agent.isRunning = true;
    });

    await user.click(screen.getByTestId("assistant-new-session"));

    expect(mockCopilotKit.stopAgent).toHaveBeenCalledWith({ agent });
  });

  it("closes from its close button", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.click(await screen.findByTestId("assistant-close"));

    expect(onClose).toHaveBeenCalled();
  });

  it("closes itself on a read-only flow", () => {
    mockReadOnly = true;
    const { onClose } = renderPanel();

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId("assistant-panel")).not.toBeInTheDocument();
  });

  it("explains a disabled assistant instead of opening a chat", () => {
    useUtilityStore.setState({ agenticExperienceEnabled: false });
    renderPanel();

    expect(screen.getByTestId("assistant-disabled-state")).toBeInTheDocument();
    expect(screen.queryByTestId("copilot-chat")).not.toBeInTheDocument();
  });

  it("stays mounted but hidden while closed", () => {
    renderPanel({ isOpen: false });

    expect(screen.getByTestId("assistant-panel")).not.toBeVisible();
    expect(screen.queryByTestId("copilot-chat")).not.toBeInTheDocument();
  });

  it("has no detectable a11y violations", async () => {
    const { container } = renderPanel();
    await screen.findByTestId("copilot-agent-picker");

    expect(await axe(container)).toHaveNoViolations();
  });
});
