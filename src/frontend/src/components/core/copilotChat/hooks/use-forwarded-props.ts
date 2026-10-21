import { useMemo } from "react";
import type { AssistantModel } from "@/components/core/copilotChat/types";
import useCopilotChatStore from "@/stores/copilotChatStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";

interface ForwardedPropsSource {
  flowId?: string | null;
  model?: AssistantModel | null;
  historyLimit?: number | null;
  iterationsLimit?: number | null;
}

/** The ``forwardedProps`` object for these settings. */
export function forwardedPropsFrom({
  flowId,
  model,
  historyLimit,
  iterationsLimit,
}: ForwardedPropsSource): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (flowId) props.flow_id = flowId;
  if (model) {
    props.provider = model.provider;
    props.model_name = model.name;
  }
  if (historyLimit !== null && historyLimit !== undefined) {
    props.history_limit = historyLimit;
  }
  if (iterationsLimit !== null && iterationsLimit !== undefined) {
    props.iterations_limit = iterationsLimit;
  }
  return props;
}

/**
 * What every agent run carries as ``RunAgentInput.forwardedProps`` (sent through
 * the provider's ``properties``): the open flow, so the Langflow Assistant edits
 * the canvas the user is looking at, the model picked in the panel header, and
 * the ``/history`` and ``/iterations`` limits.
 */
export function useForwardedProps(): Record<string, unknown> {
  const flowId = useFlowsManagerStore((state) => state.currentFlowId);
  const model = useCopilotChatStore((state) => state.selectedModel);
  const historyLimit = useCopilotChatStore((state) => state.historyLimit);
  const iterationsLimit = useCopilotChatStore((state) => state.iterationsLimit);

  return useMemo(
    () => forwardedPropsFrom({ flowId, model, historyLimit, iterationsLimit }),
    [flowId, model, historyLimit, iterationsLimit],
  );
}
