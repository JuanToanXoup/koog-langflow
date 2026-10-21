import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import useCopilotChatStore from "@/stores/copilotChatStore";
import { CopilotModelPicker } from "../components/copilot-model-picker";

const mockApiGet = jest.fn();
jest.mock("@/controllers/API/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

jest.mock("@/components/core/copilotChat/components/model-selector", () => ({
  ModelSelector: ({
    selectedModel,
  }: {
    selectedModel: { provider: string; name: string } | null;
  }) => (
    <div data-testid="model-selector">
      {selectedModel
        ? `${selectedModel.provider}/${selectedModel.name}`
        : "none"}
    </div>
  ),
}));

function renderPicker() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<CopilotModelPicker />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe("CopilotModelPicker", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApiGet.mockReset();
    useCopilotChatStore.setState({ selectedModel: null });
  });

  it("starts from the user's default language model", async () => {
    mockApiGet.mockResolvedValue({
      data: {
        default_model: {
          model_name: "claude-fable-5-1",
          provider: "OpenAI Compatible",
          model_type: "language",
        },
      },
    });

    renderPicker();

    await waitFor(() =>
      expect(screen.getByTestId("model-selector")).toHaveTextContent(
        "OpenAI Compatible/claude-fable-5-1",
      ),
    );
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining("models/default_model?model_type=language"),
    );
    expect(
      JSON.parse(localStorage.getItem("langflow-assistant-selected-model")!),
    ).toMatchObject({
      provider: "OpenAI Compatible",
      name: "claude-fable-5-1",
    });
  });

  it("waits for the default before showing the selector", () => {
    mockApiGet.mockReturnValue(new Promise(() => undefined));

    renderPicker();

    expect(screen.queryByTestId("model-selector")).not.toBeInTheDocument();
  });

  it("keeps a model the user already picked", async () => {
    useCopilotChatStore.setState({
      selectedModel: {
        id: "Anthropic-claude-opus-5-5",
        name: "claude-opus-5-5",
        provider: "Anthropic",
        displayName: "claude-opus-5-5",
      },
    });

    renderPicker();

    expect(screen.getByTestId("model-selector")).toHaveTextContent(
      "Anthropic/claude-opus-5-5",
    );
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it("lets the selector choose when there is no default", async () => {
    mockApiGet.mockResolvedValue({ data: { default_model: null } });

    renderPicker();

    expect(await screen.findByTestId("model-selector")).toHaveTextContent(
      "none",
    );
  });
});
