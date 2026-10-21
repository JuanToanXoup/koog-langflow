import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgenticProgressEvent,
  AgenticToolStartEvent,
} from "@/controllers/API/queries/agentic";
import { markLiveToolCall } from "../tools/tool-answer";

interface Subscribable {
  isRunning: boolean;
  subscribe: (subscriber: {
    onRunInitialized?: () => void;
    onRunFinalized?: () => void;
    onRunFailed?: () => void;
    onCustomEvent?: (params: {
      event: { name: string; value: unknown };
    }) => void;
    onToolCallStartEvent?: (params: { event: { toolCallId: string } }) => void;
  }) => { unsubscribe: () => void };
}

export interface AssistantRunState {
  running: boolean;
  /** Latest ``langflow.progress`` step and its human message. */
  step?: string;
  message?: string;
  /** The canvas tool executing right now (``langflow.tool_start``). */
  toolLabel?: string;
}

/**
 * Follow a run through the ``langflow`` agent's CUSTOM events. They are not
 * messages, so CopilotKit does not render them; this keeps the latest one for
 * the status line while a run is going.
 */
export function useAssistantRunState(agent: Subscribable): AssistantRunState {
  const [state, setState] = useState<AssistantRunState>({
    running: agent.isRunning,
  });

  useEffect(() => {
    setState({ running: agent.isRunning });
    const subscription = agent.subscribe({
      onRunInitialized: () => setState({ running: true }),
      onRunFinalized: () => setState({ running: false }),
      onRunFailed: () => setState({ running: false }),
      onCustomEvent: ({ event }) => {
        if (event.name === "langflow.progress") {
          const progress = event.value as Partial<AgenticProgressEvent>;
          setState((s) => ({
            ...s,
            running: true,
            step: progress.step,
            message: progress.message,
          }));
        } else if (event.name === "langflow.tool_start") {
          const tool = event.value as Partial<AgenticToolStartEvent>;
          setState((s) => ({
            ...s,
            running: true,
            toolLabel: tool.label || tool.tool,
          }));
        }
      },
      // The tool's result lands as a tool call; the "doing X" line is done.
      onToolCallStartEvent: ({ event }) => {
        markLiveToolCall(event.toolCallId);
        setState((s) => ({ ...s, toolLabel: undefined }));
      },
    });
    return () => subscription.unsubscribe();
  }, [agent]);

  return state;
}

/** One line under the header while the assistant works: what it is doing now. */
export function AssistantProgress({ state }: { state: AssistantRunState }) {
  const { t } = useTranslation();
  if (!state.running) return null;
  const label = state.toolLabel || state.message || t("assistant.working");
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="copilot-assistant-progress"
      className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </div>
  );
}
