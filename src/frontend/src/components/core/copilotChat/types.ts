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

export type FlowProposalStatus = "pending" | "applied" | "dismissed";

/**
 * Status of the BUILD-mode planning gate that runs before the agent builds.
 *
 * - "pending"    — the card shows Continue/Dismiss; the agent is waiting.
 * - "refining"   — the user dismissed it; their next message carries the plan
 *                  as context so the agent can replan.
 * - "approved"   — the user clicked Continue; the agent is building.
 * - "dismissed"  — the planning gate is closed and no plan is re-injected.
 */
export type PlanProposalStatus =
  | "pending"
  | "refining"
  | "approved"
  | "dismissed";

/** A single incremental canvas operation surfaced to the user as a task. */
export type BuildTaskAction =
  | "add_component"
  | "remove_component"
  | "connect"
  | "configure";

export interface BuildTask {
  /** Canvas action that produced this entry. */
  action: BuildTaskAction;
  /** Subject component id for add/remove/configure. */
  componentId?: string;
  /** Friendly type label for add (e.g. "ChatInput"). */
  componentType?: string;
  /** Source endpoint for connect. */
  sourceId?: string;
  /** Target endpoint for connect. */
  targetId?: string;
  /** Local timestamp the event was received — for ordering. */
  receivedAt: number;
}

/** A canvas-mutating tool the agent is executing right now (not yet completed). */
export interface InProgressBuildTask {
  /** Backend tool name, e.g. "add_component", "build_flow". */
  tool: string;
  /** English fallback label from the backend; the UI prefers i18n by tool. */
  label?: string;
  /** Friendly type for add_component (e.g. "ChatInput"). */
  componentType?: string;
  /** Subject component id for remove/configure/propose. */
  componentId?: string;
  /** Source endpoint for connect_components. */
  sourceId?: string;
  /** Target endpoint for connect_components. */
  targetId?: string;
  /** Local timestamp the event was received. */
  receivedAt: number;
}

/** A file the agent persisted via write_file or edit_file. */
export interface WrittenFile {
  /** ``"write_file"`` (new/overwrite) or ``"edit_file"`` (in-place substring replace). */
  action: "write_file" | "edit_file";
  /** Path relative to the user's sandbox root. */
  path: string;
  /** File size in bytes after the operation. */
  size: number;
  /** Local timestamp the event was received — for ordering inside the message. */
  receivedAt: number;
  /**
   * Final text content of the file, shipped inline so the UI can render it
   * without a second fetch. Absent for ``edit_file`` events.
   */
  content?: string;
}

export interface AssistantModel {
  id: string;
  name: string;
  provider: string;
  displayName: string;
}
