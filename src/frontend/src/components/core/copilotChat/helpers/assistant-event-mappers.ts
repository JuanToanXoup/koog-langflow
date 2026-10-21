/**
 * Pure mapper from an assistant ``flow_update`` payload to the checklist row
 * the chat shows for each applied canvas edit.
 */

import type { AgenticFlowUpdateEvent } from "@/controllers/API/queries/agentic";
import type { BuildTask } from "../types";

/**
 * Map a canvas SSE event onto a structured ``BuildTask`` for the inline
 * checklist UI. Returns null for events that already have dedicated UX
 * (set_flow goes through the Continue card; edit_field goes through the
 * carousel; meta events like select_output / set_connection_mode don't
 * deserve their own bullet).
 */
export function buildTaskFromEvent(
  event: AgenticFlowUpdateEvent,
): BuildTask | null {
  const receivedAt = Date.now();
  switch (event.action) {
    case "add_component": {
      const node = (event.node ?? {}) as {
        id?: string;
        data?: { type?: string };
      };
      const componentId = typeof node.id === "string" ? node.id : undefined;
      const componentType =
        (event.component_type as string | undefined) ?? node.data?.type;
      return {
        action: "add_component",
        componentId,
        componentType,
        receivedAt,
      };
    }
    case "remove_component": {
      const componentId =
        typeof event.component_id === "string" ? event.component_id : undefined;
      return { action: "remove_component", componentId, receivedAt };
    }
    case "connect": {
      const sourceId =
        typeof event.source_id === "string" ? event.source_id : undefined;
      const targetId =
        typeof event.target_id === "string" ? event.target_id : undefined;
      return { action: "connect", sourceId, targetId, receivedAt };
    }
    case "configure": {
      const componentId =
        typeof event.component_id === "string" ? event.component_id : undefined;
      return { action: "configure", componentId, receivedAt };
    }
    default:
      return null;
  }
}
