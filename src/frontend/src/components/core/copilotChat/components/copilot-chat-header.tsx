import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Button } from "@/components/ui/button";
import type { CopilotAgentInfo } from "../hooks/use-copilot-runtime-info";
import { AgentPicker } from "./agent-picker";

interface CopilotChatHeaderProps {
  agents: CopilotAgentInfo[];
  agentId: string;
  onAgentChange: (agentId: string) => void;
  onNewSession: () => void;
  canStartNewSession: boolean;
  onClose: () => void;
  /** Extra controls (the model picker, the skip-all badge) after the agent picker. */
  children?: ReactNode;
}

export function CopilotChatHeader({
  agents,
  agentId,
  onAgentChange,
  onNewSession,
  canStartNewSession,
  onClose,
  children,
}: CopilotChatHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      <div className="flex min-w-0 items-center gap-1">
        <AgentPicker
          agents={agents}
          selectedAgentId={agentId}
          onSelect={onAgentChange}
        />
        {children}
      </div>
      <div className="flex items-center">
        <ShadTooltip content={t("assistant.newSession")} side="bottom">
          <Button
            variant="ghost"
            size="iconMd"
            data-testid="assistant-new-session"
            aria-label={t("assistant.newSession")}
            onClick={onNewSession}
            disabled={!canStartNewSession}
          >
            <ForwardedIconComponent name="SquarePen" className="h-4 w-4" />
          </Button>
        </ShadTooltip>
        <ShadTooltip content={t("assistant.close")} side="bottom">
          <Button
            variant="ghost"
            size="iconMd"
            data-testid="assistant-close"
            aria-label={t("assistant.close")}
            onClick={onClose}
          >
            <ForwardedIconComponent name="X" className="h-4 w-4" />
          </Button>
        </ShadTooltip>
      </div>
    </div>
  );
}
