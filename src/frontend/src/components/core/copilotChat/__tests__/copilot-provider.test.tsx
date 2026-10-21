import { render, screen } from "@testing-library/react";
import {
  __lastProps,
  __resetCopilotKitMock,
} from "@/__mocks__/@copilotkit/react-core-v2";
import { useUtilityStore } from "@/stores/utilityStore";
import {
  COPILOTKIT_RUNTIME_URL,
  CopilotProvider,
  useCopilotChatEnabled,
} from "../copilot-provider";

jest.mock("@/customization/hooks/use-custom-api-headers", () => ({
  useCustomApiHeaders: () => ({ "Accept-Language": "en" }),
}));

function EnabledProbe() {
  return <span data-testid="enabled">{String(useCopilotChatEnabled())}</span>;
}

describe("CopilotProvider", () => {
  beforeEach(() => {
    __resetCopilotKitMock();
    useUtilityStore.setState({
      copilotkitChatEnabled: true,
      agenticExperienceEnabled: true,
    });
  });

  it("connects to the Langflow CopilotKit runtime", () => {
    render(
      <CopilotProvider properties={{ flow_id: "f1" }}>
        <span data-testid="child" />
      </CopilotProvider>,
    );

    expect(screen.getByTestId("copilotkit-provider")).toBeInTheDocument();
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(__lastProps.provider).toMatchObject({
      runtimeUrl: COPILOTKIT_RUNTIME_URL,
      agentId: "langflow",
      headers: { "Accept-Language": "en" },
      properties: { flow_id: "f1" },
      enableInspector: false,
    });
    expect(COPILOTKIT_RUNTIME_URL).toBe("/api/v1/copilotkit");
  });

  it.each([
    [
      "the server turned the CopilotKit chat off",
      { copilotkitChatEnabled: false },
    ],
    ["the agentic experience is off", { agenticExperienceEnabled: false }],
  ])("renders children without a runtime when %s", (_label, state) => {
    useUtilityStore.setState(state);

    render(
      <CopilotProvider>
        <EnabledProbe />
      </CopilotProvider>,
    );

    expect(screen.queryByTestId("copilotkit-provider")).not.toBeInTheDocument();
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
    expect(__lastProps.provider).toBeUndefined();
  });
});
