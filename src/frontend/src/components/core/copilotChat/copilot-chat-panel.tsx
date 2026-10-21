import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { AssistantDisabledState } from "@/components/core/assistantPanel/components/assistant-disabled-state";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsFlowReadOnly } from "@/contexts/permissionsContext";
import { BASE_URL_API } from "@/customization/config-constants";
import useCopilotChatStore, {
  DEFAULT_COPILOT_AGENT,
} from "@/stores/copilotChatStore";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { cn } from "@/utils/utils";
import { CopilotChatHeader } from "./components/copilot-chat-header";
import { CopilotModelPicker } from "./components/copilot-model-picker";
import { useCopilotChatEnabled } from "./copilot-provider";
import { useCopilotRuntimeInfo } from "./hooks/use-copilot-runtime-info";
import { MIN_PANEL_SIZE, usePanelSize } from "./hooks/use-panel-size";
import { usePersistedThread } from "./hooks/use-persisted-thread";

export interface CopilotChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Best-effort reset of the assistant's server-side session state (registered
 * components, conversation buffer) when a new thread starts. A failure only
 * means the next turn sees stale components once.
 */
function resetAssistantSession(threadId: string): void {
  void fetch(
    `${BASE_URL_API}agentic/sessions/reset?session_id=${encodeURIComponent(threadId)}`,
    { method: "POST", credentials: "include" },
  ).catch(() => undefined);
}

/**
 * The assistant panel: a floating, resizable window over the canvas that
 * hosts the CopilotKit chat. Same place, size and dismissal rules as the
 * previous panel; the conversation UI inside is CopilotKit's.
 */
export function CopilotChatPanel({ isOpen, onClose }: CopilotChatPanelProps) {
  const enabled = useCopilotChatEnabled();
  const panelRef = useRef<HTMLDivElement>(null);
  const currentFlowId = useFlowsManagerStore((state) => state.currentFlowId);
  const isReadOnly = useIsFlowReadOnly(currentFlowId);
  // The expanded flow sidebar offsets the canvas 280px; shift by half to stay centered.
  const isSidebarOpen = useSidebar().open;
  const { size, startResize } = usePanelSize();
  const { t } = useTranslation();

  useEffect(() => {
    if (isOpen && isReadOnly) onClose();
  }, [isOpen, isReadOnly, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (panelRef.current?.contains(target)) return;
      // Menus, popovers and dialogs portal outside the panel.
      if (
        target.closest?.("[role='menu']") ||
        target.closest?.("[data-radix-popper-content-wrapper]") ||
        target.closest?.("[role='dialog']") ||
        target.closest?.("[data-radix-dialog-overlay]") ||
        document.querySelector("[data-radix-popper-content-wrapper]") ||
        document.querySelector("[role='dialog']")
      )
        return;
      // The toggle buttons handle their own clicks.
      if (target.closest?.("[data-testid='main_canvas_controls']")) return;
      if (target.closest?.("[data-resize-handle]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isOpen, onClose]);

  if (isReadOnly || (!isOpen && !enabled)) return null;

  return (
    <div
      ref={panelRef}
      data-testid="assistant-panel"
      role="complementary"
      aria-label={t("assistant.title")}
      hidden={!isOpen}
      className={cn(
        "fixed bottom-16 z-50 flex -translate-x-1/2 flex-col rounded-2xl border border-border bg-background shadow-xl",
        "max-w-[calc(100vw-2rem)]",
        isSidebarOpen ? "left-[calc(50%+140px)]" : "left-1/2",
        !isOpen && "hidden",
      )}
      style={{
        width: size.width,
        height: size.height,
        minWidth: MIN_PANEL_SIZE.width,
      }}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
        {enabled && currentFlowId ? (
          <CopilotChatSession
            flowId={currentFlowId}
            isOpen={isOpen}
            onClose={onClose}
          />
        ) : (
          <AssistantDisabledState />
        )}
      </div>
      <PanelResizeHandles onResizeStart={startResize} />
    </div>
  );
}

function CopilotChatSession({
  flowId,
  isOpen,
  onClose,
}: {
  flowId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { copilotkit } = useCopilotKit();
  const agentId = useCopilotChatStore((state) => state.agentId);
  const setAgentId = useCopilotChatStore((state) => state.setAgentId);
  const threadId = useCopilotChatStore((state) => state.threadIds[flowId]);
  const ensureThreadId = useCopilotChatStore((state) => state.ensureThreadId);
  const startNewThread = useCopilotChatStore((state) => state.startNewThread);

  useEffect(() => {
    if (!threadId) ensureThreadId(flowId);
  }, [flowId, threadId, ensureThreadId]);

  const { data: agents = [] } = useCopilotRuntimeInfo({ enabled: true });
  // A remembered agent the runtime no longer offers falls back to the default.
  useEffect(() => {
    if (agents.length === 0 || agents.some((a) => a.id === agentId)) return;
    const fallback =
      agents.find((a) => a.id === DEFAULT_COPILOT_AGENT) ?? agents[0];
    setAgentId(fallback.id);
  }, [agents, agentId, setAgentId]);

  const { agent } = usePersistedThread(agentId, threadId);

  const handleNewSession = useCallback(() => {
    if (agent.isRunning) copilotkit.stopAgent({ agent });
    const next = startNewThread(flowId);
    resetAssistantSession(next);
  }, [agent, copilotkit, flowId, startNewThread]);

  const labels = useMemo(
    () => ({
      chatInputPlaceholder: t("assistant.copilot.placeholder"),
      welcomeMessageText: t("assistant.copilot.welcome"),
      chatDisclaimerText: "",
    }),
    [t],
  );

  if (!isOpen || !threadId) return null;

  return (
    <>
      <CopilotChatHeader
        agents={agents}
        agentId={agentId}
        onAgentChange={setAgentId}
        onNewSession={handleNewSession}
        canStartNewSession={agent.messages.length > 0}
        onClose={onClose}
      >
        <CopilotModelPicker />
      </CopilotChatHeader>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <CopilotChatConfigurationProvider
          agentId={agentId}
          threadId={threadId}
          hasExplicitThreadId={false}
          labels={labels}
        >
          {/* Keyed so a thread or agent switch mounts a fresh chat instead of
            CopilotChat clearing (and racing) the restored transcript. */}
          <CopilotChat
            key={`${agentId}:${threadId}`}
            agentId={agentId}
            labels={labels}
            className="h-full"
          />
        </CopilotChatConfigurationProvider>
      </div>
    </>
  );
}

function PanelResizeHandles({
  onResizeStart,
}: {
  onResizeStart: (
    e: ReactMouseEvent,
    edges: { x?: "left" | "right"; y?: "top" },
  ) => void;
}) {
  const edge = "absolute z-30 rounded-full transition-colors";
  return (
    <>
      <div
        data-resize-handle
        className={cn(
          edge,
          "top-3 bottom-3 -left-[5px] w-[10px] cursor-ew-resize hover:bg-primary/20",
        )}
        onMouseDown={(e) => onResizeStart(e, { x: "left" })}
      />
      <div
        data-resize-handle
        className={cn(
          edge,
          "top-3 bottom-3 -right-[5px] w-[10px] cursor-ew-resize hover:bg-primary/20",
        )}
        onMouseDown={(e) => onResizeStart(e, { x: "right" })}
      />
      <div
        data-resize-handle
        className={cn(
          edge,
          "-top-[5px] right-3 left-3 h-[10px] cursor-ns-resize hover:bg-primary/20",
        )}
        onMouseDown={(e) => onResizeStart(e, { y: "top" })}
      />
      <div
        data-resize-handle
        className={cn(
          edge,
          "-top-[5px] -left-[5px] h-[14px] w-[14px] cursor-nw-resize hover:bg-primary/30",
        )}
        onMouseDown={(e) => onResizeStart(e, { x: "left", y: "top" })}
      />
      <div
        data-resize-handle
        className={cn(
          edge,
          "-top-[5px] -right-[5px] h-[14px] w-[14px] cursor-ne-resize hover:bg-primary/30",
        )}
        onMouseDown={(e) => onResizeStart(e, { x: "right", y: "top" })}
      />
    </>
  );
}

export default CopilotChatPanel;
