import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  __getMockAgent,
  __resetCopilotKitMock,
  mockCopilotKit,
} from "@/__mocks__/@copilotkit/react-core-v2";
import useAssistantManagerStore from "@/stores/assistantManagerStore";
import useCopilotChatStore from "@/stores/copilotChatStore";
import useFlowStore from "@/stores/flowStore";
import {
  markLiveToolCall,
  PLAN_APPROVAL_TEXT,
  useToolCardState,
} from "../tool-answer";
import {
  AppliedUpdateRow,
  ComponentCard,
  FieldEditsCard,
  FlowProposalCard,
  PlanCard,
  TurnSummary,
} from "../tool-cards";

const mockApplyProposal = jest.fn();
jest.mock("../../helpers/apply-flow-proposal", () => ({
  applyFlowProposalToCanvas: (...args: unknown[]) => mockApplyProposal(...args),
}));

jest.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => jest.fn(),
}));

const mockSaveFlow = jest.fn(async () => undefined);
jest.mock("@/hooks/flows/use-save-flow", () => ({
  __esModule: true,
  default: () => mockSaveFlow,
}));

const mockAddComponent = jest.fn();
jest.mock("@/hooks/use-add-component", () => ({
  useAddComponent: () => mockAddComponent,
}));

const mockValidate = jest.fn();
jest.mock(
  "@/controllers/API/queries/nodes/use-post-validate-component-code",
  () => ({
    usePostValidateComponentCode: () => ({ mutateAsync: mockValidate }),
  }),
);

// The presentational cards are the previous panel's, tested on their own; stand-ins
// expose their callbacks as buttons.
jest.mock(
  "@/components/core/copilotChat/components/assistant-flow-preview",
  () => ({
    AssistantFlowPreview: ({
      status,
      onApply,
      onDismiss,
      onRevert,
      canRevert,
      flowPreview,
    }: {
      status: string;
      onApply: (mode: "add" | "replace") => void;
      onDismiss: () => void;
      onRevert: () => void;
      canRevert: boolean;
      flowPreview: { name: string; nodeCount: number };
    }) => (
      <div data-testid="preview" data-status={status}>
        {flowPreview.name}:{flowPreview.nodeCount}
        <button type="button" onClick={() => onApply("add")}>
          add
        </button>
        <button type="button" onClick={onDismiss}>
          dismiss
        </button>
        {canRevert && (
          <button type="button" onClick={onRevert}>
            revert
          </button>
        )}
      </div>
    ),
  }),
);

jest.mock(
  "@/components/core/copilotChat/components/assistant-flow-edit-card",
  () => ({
    FlowEditCarousel: ({
      actions,
      onUpdateAction,
    }: {
      actions: { id: string; status: string }[];
      onUpdateAction: (id: string, status: "applied" | "dismissed") => void;
    }) => (
      <div data-testid="edits">
        {actions.map((a) => (
          <span key={a.id} data-testid={`edit-${a.id}`} data-status={a.status}>
            <button
              type="button"
              onClick={() => onUpdateAction(a.id, "applied")}
            >
              accept {a.id}
            </button>
            <button
              type="button"
              onClick={() => onUpdateAction(a.id, "dismissed")}
            >
              dismiss {a.id}
            </button>
          </span>
        ))}
      </div>
    ),
  }),
);

jest.mock(
  "@/components/core/copilotChat/components/assistant-plan-card",
  () => ({
    AssistantPlanCard: ({
      status,
      onApprove,
      onDismiss,
      onReset,
    }: {
      status: string;
      onApprove: () => void;
      onDismiss: () => void;
      onReset: () => void;
    }) => (
      <div data-testid="plan" data-status={status}>
        <button type="button" onClick={onApprove}>
          continue
        </button>
        <button type="button" onClick={onDismiss}>
          dismiss
        </button>
        <button type="button" onClick={onReset}>
          reset
        </button>
      </div>
    ),
  }),
);

jest.mock(
  "@/components/core/copilotChat/components/assistant-component-result",
  () => ({
    AssistantComponentResult: ({
      result,
      onApprove,
    }: {
      result: { className?: string };
      onApprove: () => void;
    }) => (
      <button type="button" onClick={onApprove}>
        add {result.className}
      </button>
    ),
  }),
);

jest.mock(
  "@/components/core/copilotChat/components/assistant-validation-failed",
  () => ({
    AssistantValidationFailed: ({
      result,
    }: {
      result: { validationError?: string };
    }) => <p data-testid="validation-failed">{result.validationError}</p>,
  }),
);

jest.mock(
  "@/components/core/copilotChat/components/assistant-revert-action",
  () => ({
    AssistantRevertAction: ({
      restoreVersionId,
    }: {
      restoreVersionId: string;
    }) => <span data-testid="revert">{restoreVersionId}</span>,
  }),
);

jest.mock(
  "@/components/core/copilotChat/components/file-content-modal",
  () => ({ FileContentModal: () => null }),
);

jest.mock("@/components/common/messageMetadataComponent", () => ({
  __esModule: true,
  default: ({ duration }: { duration?: number }) => (
    <span data-testid="metadata">{duration}</span>
  ),
}));

const agent = () => __getMockAgent("langflow");

function toolResults() {
  return agent()
    .messages.filter((m) => m.role === "tool")
    .map((m) => ({
      toolCallId: m.toolCallId,
      ...JSON.parse(String(m.content)),
    }));
}

const FLOW = { name: "Chat", data: { nodes: [{ id: "a" }], edges: [] } };

describe("tool cards", () => {
  beforeEach(() => {
    __resetCopilotKitMock();
    jest.clearAllMocks();
    useToolCardState.setState({ snapshots: {}, marks: {} });
    useAssistantManagerStore.setState({ assistantSidebarOpen: true });
    useFlowStore.setState({ nodes: [], edges: [] } as never);
    useCopilotChatStore.setState({ skipAll: false });
  });

  describe("skip-all", () => {
    beforeEach(() => useCopilotChatStore.setState({ skipAll: true }));

    it("approves a plan that just arrived", () => {
      markLiveToolCall("t-live-plan");
      render(
        <PlanCard
          toolCallId="t-live-plan"
          status="inProgress"
          args={{ markdown: "1." }}
        />,
      );

      expect(toolResults()).toEqual([
        { toolCallId: "t-live-plan", approved: true },
      ]);
      expect(mockCopilotKit.runAgent).toHaveBeenCalledTimes(1);
    });

    it("replaces the canvas with a flow that just arrived, keeping the panel open", () => {
      markLiveToolCall("t-live-flow");
      render(
        <FlowProposalCard
          toolCallId="t-live-flow"
          status="inProgress"
          args={{ value: { flow: FLOW, node_count: 1 } }}
        />,
      );

      expect(mockApplyProposal).toHaveBeenCalledWith(
        expect.objectContaining({ flow: FLOW }),
        "replace",
        expect.any(Function),
      );
      expect(toolResults()).toEqual([
        { toolCallId: "t-live-flow", applied: true, mode: "replace" },
      ]);
      expect(useAssistantManagerStore.getState().assistantSidebarOpen).toBe(
        true,
      );
    });

    it("leaves a proposal restored from history for a click", () => {
      render(
        <PlanCard
          toolCallId="t-restored"
          status="inProgress"
          args={{ markdown: "1." }}
        />,
      );

      expect(toolResults()).toEqual([]);
      expect(mockCopilotKit.runAgent).not.toHaveBeenCalled();
    });
  });

  describe("AppliedUpdateRow", () => {
    it("lists an added component", () => {
      render(
        <AppliedUpdateRow
          toolCallId="t1"
          status="complete"
          args={{
            value: {
              event: "flow_update",
              action: "add_component",
              component_type: "ChatInput",
              node: { id: "n1" },
            },
          }}
        />,
      );

      expect(screen.getByText("Added ChatInput")).toBeInTheDocument();
    });

    it("says when the whole flow was replaced", () => {
      render(
        <AppliedUpdateRow
          toolCallId="t1"
          status="complete"
          args={{ value: { event: "flow_update", action: "set_flow" } }}
        />,
      );

      expect(screen.getByTestId("copilot-flow-replaced")).toBeInTheDocument();
    });

    it("stays quiet for bookkeeping updates", () => {
      const { container } = render(
        <AppliedUpdateRow
          toolCallId="t1"
          status="complete"
          args={{ value: { event: "flow_update", action: "select_output" } }}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("FlowProposalCard", () => {
    const args = {
      value: {
        flow: FLOW,
        name: "Chat",
        node_count: 1,
        edge_count: 0,
        tail_updates: [
          { event: "flow_update" as const, action: "configure" as const },
        ],
      },
    };

    it("adds the proposal to the canvas and records the decision", () => {
      render(
        <FlowProposalCard toolCallId="t1" status="inProgress" args={args} />,
      );
      expect(screen.getByTestId("preview")).toHaveAttribute(
        "data-status",
        "pending",
      );

      fireEvent.click(screen.getByText("add"));

      expect(mockApplyProposal).toHaveBeenCalledWith(
        {
          flow: FLOW,
          name: "Chat",
          nodeCount: 1,
          edgeCount: 0,
          tailUpdates: args.value.tail_updates,
        },
        "add",
        expect.any(Function),
      );
      expect(toolResults()).toEqual([
        { toolCallId: "t1", applied: true, mode: "add" },
      ]);
      expect(useToolCardState.getState().snapshots.t1).toBeDefined();
      expect(useAssistantManagerStore.getState().assistantSidebarOpen).toBe(
        false,
      );
      expect(mockCopilotKit.runAgent).not.toHaveBeenCalled();
    });

    it("shows an applied proposal and reverts it", () => {
      const before = { nodes: [{ id: "old" }], edges: [] };
      useToolCardState.getState().setSnapshot("t1", before);
      const setNodesAndEdges = jest.fn();
      useFlowStore.setState({ setNodesAndEdges } as never);
      render(
        <FlowProposalCard
          toolCallId="t1"
          status="complete"
          args={args}
          result={JSON.stringify({ applied: true, mode: "replace" })}
        />,
      );
      expect(screen.getByTestId("preview")).toHaveAttribute(
        "data-status",
        "applied",
      );

      fireEvent.click(screen.getByText("revert"));

      expect(setNodesAndEdges).toHaveBeenCalledWith(before.nodes, before.edges);
      expect(useToolCardState.getState().snapshots.t1).toBeUndefined();
    });

    it("records a dismissal without running the agent", () => {
      render(
        <FlowProposalCard toolCallId="t1" status="inProgress" args={args} />,
      );

      fireEvent.click(screen.getByText("dismiss"));

      expect(toolResults()).toEqual([{ toolCallId: "t1", applied: false }]);
      expect(mockApplyProposal).not.toHaveBeenCalled();
    });

    it("answers a tool call only once", () => {
      render(
        <FlowProposalCard toolCallId="t1" status="inProgress" args={args} />,
      );

      fireEvent.click(screen.getByText("dismiss"));
      fireEvent.click(screen.getByText("dismiss"));

      expect(toolResults()).toHaveLength(1);
    });
  });

  describe("FieldEditsCard", () => {
    const edits = [
      { id: "e1", field: "temperature", patch: [] },
      { id: "e2", field: "model", patch: [] },
    ];

    it("answers once every edit is decided and resumes a larger request", async () => {
      render(
        <FieldEditsCard
          toolCallId="t1"
          status="inProgress"
          args={{ edits, continuation_expected: true }}
        />,
      );

      fireEvent.click(screen.getByText("accept e1"));
      expect(toolResults()).toEqual([]);
      await act(async () => {
        fireEvent.click(screen.getByText("dismiss e2"));
      });

      expect(mockSaveFlow).toHaveBeenCalled();
      expect(toolResults()).toEqual([
        {
          toolCallId: "t1",
          applied: ["e1"],
          dismissed: ["e2"],
          continue: true,
        },
      ]);
      expect(mockCopilotKit.runAgent).toHaveBeenCalledWith({ agent: agent() });
    });

    it("does not resume a pure edit", async () => {
      render(
        <FieldEditsCard
          toolCallId="t1"
          status="inProgress"
          args={{ edits: [edits[0]], continuation_expected: false }}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByText("accept e1"));
      });

      expect(toolResults()[0]).toMatchObject({ continue: false });
      expect(mockSaveFlow).not.toHaveBeenCalled();
      expect(mockCopilotKit.runAgent).not.toHaveBeenCalled();
    });

    it("shows the recorded decisions", () => {
      render(
        <FieldEditsCard
          toolCallId="t1"
          status="complete"
          args={{ edits }}
          result={JSON.stringify({ applied: ["e2"], dismissed: ["e1"] })}
        />,
      );

      expect(screen.getByTestId("edit-e1")).toHaveAttribute(
        "data-status",
        "dismissed",
      );
      expect(screen.getByTestId("edit-e2")).toHaveAttribute(
        "data-status",
        "applied",
      );
    });
  });

  describe("PlanCard", () => {
    it("approves the plan and continues the build", () => {
      render(
        <PlanCard
          toolCallId="t1"
          status="inProgress"
          args={{ markdown: "1." }}
        />,
      );

      fireEvent.click(screen.getByText("continue"));

      expect(toolResults()).toEqual([{ toolCallId: "t1", approved: true }]);
      expect(mockCopilotKit.runAgent).toHaveBeenCalled();
    });

    it("sends the plan back for changes without running", () => {
      render(
        <PlanCard
          toolCallId="t1"
          status="inProgress"
          args={{ markdown: "1." }}
        />,
      );

      fireEvent.click(screen.getByText("dismiss"));

      expect(toolResults()).toEqual([
        { toolCallId: "t1", approved: false, refine: true },
      ]);
      expect(mockCopilotKit.runAgent).not.toHaveBeenCalled();
    });

    it("approves a plan it is refining with a fresh instruction", () => {
      render(
        <PlanCard
          toolCallId="t1"
          status="complete"
          args={{ markdown: "1." }}
          result={JSON.stringify({ approved: false, refine: true })}
        />,
      );
      expect(screen.getByTestId("plan")).toHaveAttribute(
        "data-status",
        "refining",
      );

      fireEvent.click(screen.getByText("continue"));

      expect(agent().messages.at(-1)).toMatchObject({
        role: "user",
        content: PLAN_APPROVAL_TEXT,
      });
      expect(mockCopilotKit.runAgent).toHaveBeenCalled();
      expect(screen.getByTestId("plan")).toHaveAttribute(
        "data-status",
        "approved",
      );
    });

    it("drops a refining plan on reset", () => {
      render(
        <PlanCard
          toolCallId="t1"
          status="complete"
          args={{ markdown: "1." }}
          result={JSON.stringify({ approved: false, refine: true })}
        />,
      );

      fireEvent.click(screen.getByText("reset"));

      expect(agent().messages.at(-1)).toMatchObject({ role: "assistant" });
      expect(screen.getByTestId("plan")).toHaveAttribute(
        "data-status",
        "dismissed",
      );
    });
  });

  describe("ComponentCard", () => {
    const args = {
      component_code: "class X: ...",
      class_name: "X",
      validated: true,
    };

    it("validates and adds the component", async () => {
      mockValidate.mockResolvedValue({
        data: { display_name: "X" },
        type: "X",
      });
      render(<ComponentCard toolCallId="t1" status="inProgress" args={args} />);

      await act(async () => {
        fireEvent.click(screen.getByText("add X"));
      });

      expect(mockValidate).toHaveBeenCalledWith({
        code: "class X: ...",
        frontend_node: {},
      });
      expect(mockAddComponent).toHaveBeenCalledWith({ display_name: "X" }, "X");
      expect(toolResults()).toEqual([{ toolCallId: "t1", added: true }]);
    });

    it("shows why adding failed", async () => {
      mockValidate.mockRejectedValue(new Error("bad code"));
      render(<ComponentCard toolCallId="t1" status="inProgress" args={args} />);

      await act(async () => {
        fireEvent.click(screen.getByText("add X"));
      });

      expect(screen.getByTestId("validation-failed")).toHaveTextContent(
        "Failed to add component: bad code",
      );
      expect(toolResults()).toEqual([]);
    });

    it("shows a component that failed validation", () => {
      render(
        <ComponentCard
          toolCallId="t1"
          status="inProgress"
          args={{ ...args, validated: false, validation_error: "SyntaxError" }}
        />,
      );

      expect(screen.getByTestId("validation-failed")).toHaveTextContent(
        "SyntaxError",
      );
    });
  });

  describe("TurnSummary", () => {
    it("shows duration and the revert point", () => {
      render(
        <TurnSummary
          toolCallId="t1"
          status="inProgress"
          args={{ duration_seconds: 1.5, restore_version_id: "v9" }}
        />,
      );

      expect(screen.getByTestId("metadata")).toHaveTextContent("1500");
      expect(screen.getByTestId("revert")).toHaveTextContent("v9");
    });
  });
});
