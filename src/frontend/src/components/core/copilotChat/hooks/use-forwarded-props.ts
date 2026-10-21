import { useMemo } from "react";
import useCopilotChatStore from "@/stores/copilotChatStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";

/**
 * What every agent run carries as ``RunAgentInput.forwardedProps`` (sent through
 * the provider's ``properties``): the open flow, so the Langflow Assistant edits
 * the canvas the user is looking at, and the model picked in the panel header.
 */
export function useForwardedProps(): Record<string, unknown> {
  const flowId = useFlowsManagerStore((state) => state.currentFlowId);
  const model = useCopilotChatStore((state) => state.selectedModel);

  return useMemo(() => {
    const props: Record<string, unknown> = {};
    if (flowId) props.flow_id = flowId;
    if (model) {
      props.provider = model.provider;
      props.model_name = model.name;
    }
    return props;
  }, [flowId, model]);
}
