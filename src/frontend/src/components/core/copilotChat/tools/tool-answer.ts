import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { useCallback } from "react";
import { create } from "zustand";

/** The agent whose tool calls these cards answer. */
export const LANGFLOW_AGENT_ID = "langflow";

/**
 * Same text the backend recognizes as a plan approval
 * (``PLAN_APPROVAL_INPUT`` in agentic/services/flow_types.py).
 */
export const PLAN_APPROVAL_TEXT =
  "User approved the plan. Proceed with the build.";

function newMessageId(): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The JSON object a card answered with, or null while it is unanswered. */
export function parseToolAnswer<T extends object>(
  result: string | undefined,
): T | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/**
 * Answer a review card's tool call, and optionally run the agent on the answer.
 *
 * The cards are rendered tools, not CopilotKit human-in-the-loop tools: a HITL
 * handler keeps the run open until the user decides, and every message typed in
 * the meantime queues behind it. Here the run has already finished; the answer
 * is the tool result appended to the thread, and only answers that continue the
 * build (an approved plan, edits that were one step of a larger request) start
 * a follow-up run, which the ``langflow`` agent turns into the next turn.
 */
export function useToolAnswer(toolCallId: string) {
  const { agent } = useAgent({ agentId: LANGFLOW_AGENT_ID });
  const { copilotkit } = useCopilotKit();

  const answer = useCallback(
    (value: Record<string, unknown>, options?: { followUp?: boolean }) => {
      const answered = agent.messages.some(
        (m) =>
          m.role === "tool" &&
          (m as { toolCallId?: string }).toolCallId === toolCallId,
      );
      if (answered) return;
      agent.addMessage({
        id: newMessageId(),
        role: "tool",
        toolCallId,
        content: JSON.stringify(value),
      });
      if (options?.followUp && !agent.isRunning) {
        void copilotkit.runAgent({ agent });
      }
    },
    [agent, copilotkit, toolCallId],
  );

  const say = useCallback(
    (
      role: "user" | "assistant",
      content: string,
      options?: { run?: boolean },
    ) => {
      agent.addMessage({ id: newMessageId(), role, content });
      if (options?.run && !agent.isRunning) {
        void copilotkit.runAgent({ agent });
      }
    },
    [agent, copilotkit],
  );

  return { answer, say };
}

const liveToolCalls = new Set<string>();

/** Remember a tool call that streamed in during this page session. */
export function markLiveToolCall(toolCallId: string): void {
  liveToolCalls.add(toolCallId);
}

/**
 * True for a tool call that arrived while this page was open. Skip-all only
 * auto-accepts those: a proposal restored from history waits for a click.
 */
export function isLiveToolCall(toolCallId: string): boolean {
  return liveToolCalls.has(toolCallId);
}

interface ToolCardState {
  /** Canvas captured before a proposal was applied, for its Revert button. */
  snapshots: Record<string, { nodes: unknown[]; edges: unknown[] }>;
  setSnapshot: (
    toolCallId: string,
    snapshot: { nodes: unknown[]; edges: unknown[] } | undefined,
  ) => void;
  /** Per-card UI decisions that are not (yet) a tool result. */
  marks: Record<string, Record<string, string>>;
  setMark: (toolCallId: string, key: string, value: string) => void;
}

/**
 * UI state of the review cards, keyed by tool call id. Lives outside the cards
 * because CopilotKit remounts tool renders as the transcript grows.
 */
export const useToolCardState = create<ToolCardState>((set) => ({
  snapshots: {},
  setSnapshot: (toolCallId, snapshot) =>
    set((state) => {
      const snapshots = { ...state.snapshots };
      if (snapshot) snapshots[toolCallId] = snapshot;
      else delete snapshots[toolCallId];
      return { snapshots };
    }),
  marks: {},
  setMark: (toolCallId, key, value) =>
    set((state) => ({
      marks: {
        ...state.marks,
        [toolCallId]: { ...state.marks[toolCallId], [key]: value },
      },
    })),
}));
