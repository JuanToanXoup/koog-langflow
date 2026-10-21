import { render, renderHook } from "@testing-library/react";
import {
  __lastProps,
  __resetCopilotKitMock,
} from "@/__mocks__/@copilotkit/react-core-v2";
import useCopilotChatStore from "@/stores/copilotChatStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { useUtilityStore } from "@/stores/utilityStore";
import { CopilotProvider } from "../copilot-provider";
import { useForwardedProps } from "../hooks/use-forwarded-props";

jest.mock("@/customization/hooks/use-custom-api-headers", () => ({
  useCustomApiHeaders: () => ({}),
}));

const MODEL = {
  id: "OpenAI Compatible-claude-fable-5-1",
  name: "claude-fable-5-1",
  provider: "OpenAI Compatible",
  displayName: "claude-fable-5-1",
};

describe("forwarded props", () => {
  beforeEach(() => {
    __resetCopilotKitMock();
    useFlowsManagerStore.setState({ currentFlowId: "flow-1" });
    useCopilotChatStore.setState({
      selectedModel: MODEL,
      historyLimit: null,
      iterationsLimit: null,
    });
    useUtilityStore.setState({
      copilotkitChatEnabled: true,
      agenticExperienceEnabled: true,
    });
  });

  it("carries the open flow and the picked model", () => {
    const { result } = renderHook(() => useForwardedProps());

    expect(result.current).toEqual({
      flow_id: "flow-1",
      provider: "OpenAI Compatible",
      model_name: "claude-fable-5-1",
    });
  });

  it("leaves the model to the server when none is picked", () => {
    useCopilotChatStore.setState({ selectedModel: null });

    const { result } = renderHook(() => useForwardedProps());

    expect(result.current).toEqual({ flow_id: "flow-1" });
  });

  it("is what the provider sends with every run", () => {
    render(
      <CopilotProvider>
        <span />
      </CopilotProvider>,
    );

    // CopilotKit forwards provider `properties` as RunAgentInput.forwardedProps
    // (verified against @copilotkit/react-core 1.79.1 in copilotkit-spike.md).
    expect(__lastProps.provider?.properties).toEqual({
      flow_id: "flow-1",
      provider: "OpenAI Compatible",
      model_name: "claude-fable-5-1",
    });
  });

  it("carries the /history and /iterations limits once set", () => {
    useCopilotChatStore.setState({ historyLimit: 0, iterationsLimit: 40 });

    const { result } = renderHook(() => useForwardedProps());

    expect(result.current).toMatchObject({
      history_limit: 0,
      iterations_limit: 40,
    });
  });

  it("follows a flow switch", () => {
    const { result, rerender } = renderHook(() => useForwardedProps());

    useFlowsManagerStore.setState({ currentFlowId: "flow-2" });
    rerender();

    expect(result.current.flow_id).toBe("flow-2");
  });
});
