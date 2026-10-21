import { useFrontendTool, useRenderTool } from "@copilotkit/react-core/v2";
import { useUpdateNodeInternals } from "@xyflow/react";
import { z } from "zod";
import type { AgenticFlowUpdateEvent } from "@/controllers/API/queries/agentic";
import { applyFlowUpdate } from "../helpers/apply-flow-update";
import { LANGFLOW_AGENT_ID } from "./tool-answer";
import {
  AppliedUpdateRow,
  ComponentCard,
  FieldEditsCard,
  FlowProposalCard,
  PlanCard,
  type ToolCardProps,
  TurnSummary,
  takeUndoSnapshot,
  WrittenFileCard,
} from "./tool-cards";

// Tool arguments come from the model through the assistant; every field is
// optional and the cards validate what they use.
const anyObject = z.record(z.string(), z.unknown());
const flowUpdateArgs = z.object({ value: anyObject });
const proposalArgs = z.object({ value: anyObject });
const fieldEditArgs = z.object({
  edits: z.array(anyObject),
  continuation_expected: z.boolean().optional(),
});
const planArgs = z.object({ markdown: z.string() });
const componentArgs = z.object({ component_code: z.string() }).passthrough();
const fileArgs = z
  .object({ path: z.string(), action: z.string() })
  .passthrough();
const summaryArgs = anyObject;

type RenderProps = {
  toolCallId: string;
  parameters?: unknown;
  args?: unknown;
  status: string;
  result?: string;
};

/** CopilotKit passes a tool's arguments as ``parameters`` or ``args`` depending on the hook. */
function cardProps<A>(props: RenderProps): ToolCardProps<A> {
  return {
    toolCallId: props.toolCallId,
    args: ((props.parameters ?? props.args ?? {}) as Partial<A>) || {},
    status: props.status as ToolCardProps<A>["status"],
    result: props.result,
  };
}

/**
 * The ``langflow`` agent's canvas tools.
 *
 * ``apply_flow_update`` is the one tool the browser executes: the assistant
 * already decided on the change, so it is applied as it arrives (with the same
 * validation the previous panel did) and ``followUp: false`` keeps CopilotKit
 * from re-running the agent on the bare result. Everything else is a rendered
 * card; a card the user answers appends its decision as the tool result.
 */
export function useCanvasTools() {
  const updateNodeInternals = useUpdateNodeInternals();

  useFrontendTool(
    {
      name: "apply_flow_update",
      agentId: LANGFLOW_AGENT_ID,
      description: "Apply a change the Langflow Assistant made to the canvas.",
      parameters: flowUpdateArgs,
      followUp: false,
      handler: async ({ value }) => {
        takeUndoSnapshot();
        applyFlowUpdate(
          value as unknown as AgenticFlowUpdateEvent,
          updateNodeInternals,
        );
        return "applied";
      },
      render: (props) => (
        <AppliedUpdateRow
          {...cardProps<{ value: AgenticFlowUpdateEvent }>(
            props as RenderProps,
          )}
        />
      ),
    },
    [updateNodeInternals],
  );

  useRenderTool(
    {
      name: "propose_flow",
      agentId: LANGFLOW_AGENT_ID,
      parameters: proposalArgs,
      render: (props) => <FlowProposalCard {...cardProps(props)} />,
    },
    [],
  );

  useRenderTool(
    {
      name: "propose_field_edits",
      agentId: LANGFLOW_AGENT_ID,
      parameters: fieldEditArgs,
      render: (props) => <FieldEditsCard {...cardProps(props)} />,
    },
    [],
  );

  useRenderTool(
    {
      name: "propose_plan",
      agentId: LANGFLOW_AGENT_ID,
      parameters: planArgs,
      render: (props) => <PlanCard {...cardProps(props)} />,
    },
    [],
  );

  useRenderTool(
    {
      name: "propose_component",
      agentId: LANGFLOW_AGENT_ID,
      parameters: componentArgs,
      render: (props) => <ComponentCard {...cardProps(props)} />,
    },
    [],
  );

  useRenderTool(
    {
      name: "show_written_file",
      agentId: LANGFLOW_AGENT_ID,
      parameters: fileArgs,
      render: (props) => <WrittenFileCard {...cardProps(props)} />,
    },
    [],
  );

  useRenderTool(
    {
      name: "show_turn_summary",
      agentId: LANGFLOW_AGENT_ID,
      parameters: summaryArgs,
      render: (props) => <TurnSummary {...cardProps(props)} />,
    },
    [],
  );
}
