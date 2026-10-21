import { renderHook } from "@testing-library/react";
import {
  __registeredRenderers,
  __registeredTools,
  __resetCopilotKitMock,
} from "@/__mocks__/@copilotkit/react-core-v2";
import { useCanvasTools } from "../use-canvas-tools";

const mockApplyFlowUpdate = jest.fn();
jest.mock("../../helpers/apply-flow-update", () => ({
  applyFlowUpdate: (...args: unknown[]) => mockApplyFlowUpdate(...args),
}));

const mockUpdateNodeInternals = jest.fn();
jest.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => mockUpdateNodeInternals,
}));

const mockTakeUndoSnapshot = jest.fn();
jest.mock("../tool-cards", () => ({
  takeUndoSnapshot: () => mockTakeUndoSnapshot(),
  AppliedUpdateRow: () => null,
  ComponentCard: () => null,
  FieldEditsCard: () => null,
  FlowProposalCard: () => null,
  PlanCard: () => null,
  TurnSummary: () => null,
  WrittenFileCard: () => null,
}));

describe("useCanvasTools", () => {
  beforeEach(() => {
    __resetCopilotKitMock();
    mockApplyFlowUpdate.mockClear();
  });

  it("applies canvas changes as they arrive, without a follow-up run", async () => {
    renderHook(() => useCanvasTools());
    const tool = __registeredTools.get("apply_flow_update");

    expect(tool).toMatchObject({ agentId: "langflow", followUp: false });
    const event = { event: "flow_update", action: "add_component", node: {} };
    await expect(tool?.handler?.({ value: event })).resolves.toBe("applied");
    // Each assistant change is one Cmd/Ctrl+Z step.
    expect(mockTakeUndoSnapshot).toHaveBeenCalledTimes(1);
    expect(mockApplyFlowUpdate).toHaveBeenCalledWith(
      event,
      mockUpdateNodeInternals,
    );
  });

  it("renders every other assistant tool as a card for the langflow agent", () => {
    renderHook(() => useCanvasTools());

    expect([...__registeredRenderers.keys()].sort()).toEqual([
      "propose_component",
      "propose_field_edits",
      "propose_flow",
      "propose_plan",
      "show_turn_summary",
      "show_written_file",
    ]);
    for (const renderer of __registeredRenderers.values()) {
      expect(renderer.agentId).toBe("langflow");
      expect(renderer.handler).toBeUndefined();
    }
  });

  it("accepts the arguments the backend sends", () => {
    renderHook(() => useCanvasTools());
    const parse = (name: string, args: unknown) =>
      (
        (__registeredRenderers.get(name) ?? __registeredTools.get(name))
          ?.parameters as { safeParse: (v: unknown) => { success: boolean } }
      ).safeParse(args).success;

    expect(parse("apply_flow_update", { value: { action: "connect" } })).toBe(
      true,
    );
    expect(
      parse("propose_flow", { value: { flow: {}, tail_updates: [] } }),
    ).toBe(true);
    expect(
      parse("propose_field_edits", {
        edits: [{ id: "e1" }],
        continuation_expected: true,
      }),
    ).toBe(true);
    expect(parse("propose_plan", { markdown: "1." })).toBe(true);
    expect(
      parse("propose_component", { component_code: "x", class_name: null }),
    ).toBe(true);
    expect(
      parse("show_written_file", {
        path: "a.md",
        action: "write_file",
        size: 1,
      }),
    ).toBe(true);
    expect(parse("show_turn_summary", { usage: {} })).toBe(true);
  });
});
