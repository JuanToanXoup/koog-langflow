import type { AgenticFlowUpdateEvent } from "@/controllers/API/queries/agentic";

/** A flow the assistant proposes in place of (or alongside) the canvas. */
export interface PendingFlowProposal {
  flow: Record<string, unknown>;
  name?: string;
  nodeCount: number;
  edgeCount: number;
  /**
   * Events that arrived AFTER the gating set_flow. Per the agent prompt
   * this should never happen, but if it does the tail events are buffered
   * here so they replay in order when the user clicks Continue.
   */
  tailUpdates?: AgenticFlowUpdateEvent[];
}
