/**
 * What the ``langflow`` agent's tool calls look like in the chat. Each card
 * reuses the previous panel's presentational component; what changes is where
 * a decision goes: into a tool result on the thread (see ``useToolAnswer``).
 */
import { useUpdateNodeInternals } from "@xyflow/react";
import { cloneDeep } from "lodash";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import MessageMetadata from "@/components/common/messageMetadataComponent";
import type { WrittenFile } from "@/components/core/assistantPanel/assistant-panel.types";
import { AssistantBuildTasks } from "@/components/core/assistantPanel/components/assistant-build-tasks";
import { AssistantComponentResult } from "@/components/core/assistantPanel/components/assistant-component-result";
import { AssistantFileCard } from "@/components/core/assistantPanel/components/assistant-file-card";
import { FlowEditCarousel } from "@/components/core/assistantPanel/components/assistant-flow-edit-card";
import { AssistantFlowPreview } from "@/components/core/assistantPanel/components/assistant-flow-preview";
import { AssistantModelNotice } from "@/components/core/assistantPanel/components/assistant-model-notice";
import { AssistantPlanCard } from "@/components/core/assistantPanel/components/assistant-plan-card";
import { AssistantRevertAction } from "@/components/core/assistantPanel/components/assistant-revert-action";
import { AssistantValidationFailed } from "@/components/core/assistantPanel/components/assistant-validation-failed";
import { FileContentModal } from "@/components/core/assistantPanel/components/file-content-modal";
import { buildTaskFromEvent } from "@/components/core/assistantPanel/helpers/assistant-event-mappers";
import type {
  AgenticFlowUpdateEvent,
  AssistantModelNotice as AssistantModelNoticeType,
  FlowAction,
} from "@/controllers/API/queries/agentic";
import { usePostValidateComponentCode } from "@/controllers/API/queries/nodes/use-post-validate-component-code";
import { handleBlockedSave } from "@/hooks/flows/handle-blocked-save";
import useSaveFlow from "@/hooks/flows/use-save-flow";
import { useAddComponent } from "@/hooks/use-add-component";
import useAssistantManagerStore from "@/stores/assistantManagerStore";
import useFlowStore from "@/stores/flowStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import type { APIClassType } from "@/types/api";
import { applyFlowProposalToCanvas } from "../helpers/apply-flow-proposal";
import type { PendingFlowProposal } from "../types";
import {
  PLAN_APPROVAL_TEXT,
  parseToolAnswer,
  useToolAnswer,
  useToolCardState,
} from "./tool-answer";

export type ToolStatus = "inProgress" | "executing" | "complete";

export interface ToolCardProps<A> {
  toolCallId: string;
  args: Partial<A>;
  status: ToolStatus;
  result?: string;
}

const closePanel = () =>
  useAssistantManagerStore.getState().setAssistantSidebarOpen(false);

/** Push the canvas onto the undo stack, so Cmd/Ctrl+Z takes back what follows. */
export const takeUndoSnapshot = () =>
  useFlowsManagerStore.getState().takeSnapshot();

// -- apply_flow_update -----------------------------------------------------------

/** A canvas change the assistant already made: one line in its checklist. */
export function AppliedUpdateRow({
  args,
  status,
}: ToolCardProps<{ value: AgenticFlowUpdateEvent }>) {
  const { t } = useTranslation();
  const event = args.value;
  if (!event || status === "inProgress") return null;
  const task = buildTaskFromEvent(event);
  if (task) return <AssistantBuildTasks tasks={[task]} />;
  if (event.action === "set_flow") {
    return (
      <p
        className="my-1 text-sm text-muted-foreground"
        data-testid="copilot-flow-replaced"
      >
        {t("assistant.copilot.flowReplaced")}
      </p>
    );
  }
  // Bookkeeping updates (output selection, connection mode, tool mode) ride
  // along with a visible change; they get no row of their own.
  return null;
}

// -- propose_flow ----------------------------------------------------------------

interface FlowProposalArgs {
  value: {
    flow?: Record<string, unknown>;
    name?: string;
    node_count?: number;
    edge_count?: number;
    tail_updates?: AgenticFlowUpdateEvent[];
  };
}

export function toPendingFlowProposal(
  value: FlowProposalArgs["value"] | undefined,
): PendingFlowProposal | null {
  if (!value?.flow) return null;
  return {
    flow: value.flow,
    name: value.name || undefined,
    nodeCount: value.node_count ?? 0,
    edgeCount: value.edge_count ?? 0,
    tailUpdates: value.tail_updates ?? [],
  };
}

/** A flow the assistant built, offered for adding to or replacing the canvas. */
export function FlowProposalCard({
  toolCallId,
  args,
  result,
}: ToolCardProps<FlowProposalArgs>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const { answer } = useToolAnswer(toolCallId);
  const snapshot = useToolCardState((s) => s.snapshots[toolCallId]);
  const setSnapshot = useToolCardState((s) => s.setSnapshot);
  const proposal = useMemo(() => toPendingFlowProposal(args.value), [args]);
  const decision = parseToolAnswer<{ applied?: boolean }>(result);
  if (!proposal) return null;

  // After Revert the card offers the proposal again, as the previous panel did.
  const status = !decision
    ? "pending"
    : decision.applied && snapshot
      ? "applied"
      : decision.applied
        ? "pending"
        : "dismissed";

  const handleApply = (mode: "replace" | "add") => {
    const { nodes, edges } = useFlowStore.getState();
    setSnapshot(toolCallId, {
      nodes: cloneDeep(nodes) as unknown[],
      edges: cloneDeep(edges) as unknown[],
    });
    takeUndoSnapshot();
    applyFlowProposalToCanvas(proposal, mode, updateNodeInternals);
    answer({ applied: true, mode });
    // Get the panel out of the way so the new canvas is visible.
    closePanel();
  };

  const handleRevert = () => {
    if (!snapshot) return;
    useFlowStore
      .getState()
      .setNodesAndEdges(snapshot.nodes as never[], snapshot.edges as never[]);
    setSnapshot(toolCallId, undefined);
  };

  return (
    <div className="my-2" data-testid="copilot-flow-proposal">
      <AssistantFlowPreview
        flowPreview={{
          flow: proposal.flow,
          name: proposal.name ?? "",
          nodeCount: proposal.nodeCount,
          edgeCount: proposal.edgeCount,
          graph: "",
        }}
        status={status}
        onApply={handleApply}
        onDismiss={() => answer({ applied: false })}
        onRevert={handleRevert}
        canRevert={Boolean(snapshot)}
      />
    </div>
  );
}

// -- propose_field_edits ---------------------------------------------------------

interface FieldEditArgs {
  edits: Array<Partial<FlowAction> & { id?: string }>;
  continuation_expected?: boolean;
}

/** Field edits the assistant proposes, reviewed one by one or all at once. */
export function FieldEditsCard({
  toolCallId,
  args,
  result,
}: ToolCardProps<FieldEditArgs>) {
  const { answer } = useToolAnswer(toolCallId);
  const marks = useToolCardState((s) => s.marks[toolCallId]);
  const setMark = useToolCardState((s) => s.setMark);
  const saveFlow = useSaveFlow();
  const decision = parseToolAnswer<{ applied?: string[] }>(result);

  const actions: FlowAction[] = useMemo(
    () =>
      (args.edits ?? [])
        .filter((edit) => typeof edit.id === "string")
        .map((edit) => {
          const id = edit.id as string;
          const status = decision
            ? decision.applied?.includes(id)
              ? "applied"
              : "dismissed"
            : ((marks?.[id] as FlowAction["status"] | undefined) ?? "pending");
          return {
            id,
            type: "edit_field" as const,
            description: edit.description ?? "",
            component_id: edit.component_id ?? "",
            component_type: edit.component_type ?? "",
            field: edit.field ?? "",
            old_value: edit.old_value,
            new_value: edit.new_value,
            patch: edit.patch ?? [],
            status,
          };
        }),
    [args, decision, marks],
  );

  const handleUpdate = async (id: string, status: "applied" | "dismissed") => {
    setMark(toolCallId, id, status);
    const next = actions.map((a) => (a.id === id ? { ...a, status } : a));
    if (next.some((a) => a.status === "pending")) return;
    const applied = next.filter((a) => a.status === "applied").map((a) => a.id);
    const dismissed = next
      .filter((a) => a.status === "dismissed")
      .map((a) => a.id);
    // Edits that were one step of a larger request ("...and run it") resume it.
    // The next turn reads the flow from the database, so save first.
    const resume = Boolean(args.continuation_expected) && applied.length > 0;
    if (resume) {
      try {
        await saveFlow();
      } catch (error) {
        if (handleBlockedSave(error)) return;
        throw error;
      }
    }
    answer({ applied, dismissed, continue: resume }, { followUp: resume });
  };

  if (actions.length === 0) return null;
  return (
    <div className="my-2" data-testid="copilot-field-edits">
      <FlowEditCarousel
        actions={actions}
        onUpdateAction={handleUpdate}
        onBeforeApply={takeUndoSnapshot}
      />
    </div>
  );
}

// -- propose_plan ----------------------------------------------------------------

/** The build plan the assistant waits on before touching the canvas. */
export function PlanCard({
  toolCallId,
  args,
  result,
}: ToolCardProps<{ markdown: string }>) {
  const { t } = useTranslation();
  const { answer, say } = useToolAnswer(toolCallId);
  const marks = useToolCardState((s) => s.marks[toolCallId]);
  const setMark = useToolCardState((s) => s.setMark);
  const decision = parseToolAnswer<{ approved?: boolean; refine?: boolean }>(
    result,
  );
  if (!args.markdown) return null;

  const status = !decision
    ? "pending"
    : decision.approved || marks?.plan === "approved"
      ? "approved"
      : marks?.plan === "dismissed"
        ? "dismissed"
        : "refining";

  return (
    <div className="my-2" data-testid="copilot-plan">
      <AssistantPlanCard
        markdown={args.markdown}
        status={status}
        onApprove={() => {
          if (!decision) {
            answer({ approved: true }, { followUp: true });
            return;
          }
          // Approving a plan sent back for changes is a fresh instruction.
          setMark(toolCallId, "plan", "approved");
          say("user", PLAN_APPROVAL_TEXT, { run: true });
        }}
        // Dismiss keeps the plan as context for the user's next message.
        onDismiss={() => answer({ approved: false, refine: true })}
        onReset={() => {
          // A message after the tool result means the plan is no longer the
          // last thing the user answered, so it is not quoted again.
          setMark(toolCallId, "plan", "dismissed");
          say("assistant", t("assistant.copilot.planDismissed"));
        }}
      />
    </div>
  );
}

// -- propose_component -----------------------------------------------------------

interface ComponentArgs {
  component_code: string;
  class_name?: string | null;
  validated?: boolean;
  validation_error?: string | null;
  validation_attempts?: number | null;
}

/** A generated component, offered for adding to the canvas. */
export function ComponentCard({
  toolCallId,
  args,
}: ToolCardProps<ComponentArgs>) {
  const { answer } = useToolAnswer(toolCallId);
  const addComponent = useAddComponent();
  const { mutateAsync: validateComponent } = usePostValidateComponentCode();
  const [addError, setAddError] = useState<string | null>(null);
  if (!args.component_code) return null;

  const agenticResult = {
    content: "",
    validated: Boolean(args.validated) && !addError,
    className: args.class_name ?? undefined,
    componentCode: args.component_code,
    validationError: addError ?? args.validation_error ?? undefined,
    validationAttempts: args.validation_attempts ?? undefined,
  };

  const handleApprove = async () => {
    try {
      // The backend builds the frontend node from the code; the empty node is expected.
      const response = await validateComponent({
        code: args.component_code as string,
        frontend_node: {} as APIClassType,
      });
      if (response?.data) {
        addComponent(response.data, response.type || "CustomComponent");
        answer({ added: true });
        closePanel();
      }
    } catch (error) {
      setAddError(
        `Failed to add component: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return (
    <div className="my-2" data-testid="copilot-component">
      {agenticResult.validated ? (
        <AssistantComponentResult
          result={agenticResult}
          onApprove={handleApprove}
        />
      ) : (
        <AssistantValidationFailed result={agenticResult} />
      )}
    </div>
  );
}

// -- show_written_file -----------------------------------------------------------

/** A file the assistant wrote in its sandbox, with Open and Download. */
export function WrittenFileCard({ args }: ToolCardProps<WrittenFile>) {
  const [open, setOpen] = useState(false);
  if (!args.path || !args.action) return null;
  const file: WrittenFile = {
    action: args.action,
    path: args.path,
    size: args.size ?? 0,
    content: args.content,
    receivedAt: 0,
  };
  return (
    <div className="my-2" data-testid="copilot-written-file">
      <AssistantFileCard file={file} onOpen={() => setOpen(true)} />
      {open && (
        <FileContentModal
          path={file.path}
          content={file.content}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// -- show_turn_summary -----------------------------------------------------------

interface TurnSummaryArgs {
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
  };
  duration_seconds?: number;
  restore_version_id?: string;
  notices?: AssistantModelNoticeType[];
}

/** Cost and duration of a turn, recovered model errors, and its Revert point. */
export function TurnSummary({
  toolCallId,
  args,
}: ToolCardProps<TurnSummaryArgs>) {
  const reverted = useToolCardState((s) => s.marks[toolCallId]?.reverted);
  const setMark = useToolCardState((s) => s.setMark);
  const duration =
    typeof args.duration_seconds === "number"
      ? args.duration_seconds * 1000
      : undefined;
  return (
    <div
      className="mt-1 flex flex-col gap-1"
      data-testid="copilot-turn-summary"
    >
      <div className="flex items-center gap-2">
        <MessageMetadata usage={args.usage} duration={duration} subtle />
        {args.notices && args.notices.length > 0 && (
          <AssistantModelNotice notices={args.notices} />
        )}
      </div>
      {args.restore_version_id && (
        <AssistantRevertAction
          restoreVersionId={args.restore_version_id}
          reverted={reverted === "true"}
          onReverted={() => setMark(toolCallId, "reverted", "true")}
        />
      )}
    </div>
  );
}
