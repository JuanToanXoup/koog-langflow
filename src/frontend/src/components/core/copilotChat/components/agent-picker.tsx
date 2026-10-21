import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/utils";
import type { CopilotAgentInfo } from "../hooks/use-copilot-runtime-info";

interface AgentPickerProps {
  agents: CopilotAgentInfo[];
  selectedAgentId: string;
  onSelect: (agentId: string) => void;
  disabled?: boolean;
}

/** Chooses which runtime agent the chat talks to. */
export function AgentPicker({
  agents,
  selectedAgentId,
  onSelect,
  disabled = false,
}: AgentPickerProps) {
  const { t } = useTranslation();
  const selected = agents.find((agent) => agent.id === selectedAgentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || agents.length === 0}>
        <Button
          variant="ghost"
          size="sm"
          data-testid="copilot-agent-picker"
          aria-label={t("assistant.agentPicker.label")}
          className="h-8 gap-1 px-2 text-sm font-medium text-foreground"
        >
          <span className="max-w-[12rem] truncate">
            {selected?.name ?? selectedAgentId}
          </span>
          <ForwardedIconComponent
            name="ChevronDown"
            className="h-3.5 w-3.5 text-muted-foreground"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("assistant.agentPicker.label")}
        </DropdownMenuLabel>
        {agents.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            data-testid={`copilot-agent-option-${agent.id}`}
            onSelect={() => onSelect(agent.id)}
            className="flex items-start gap-2"
          >
            <ForwardedIconComponent
              name="Check"
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                agent.id === selectedAgentId ? "opacity-100" : "opacity-0",
              )}
            />
            <div className="flex min-w-0 flex-col">
              <span className="text-sm text-foreground">{agent.name}</span>
              {agent.description && (
                <span className="text-xs text-muted-foreground">
                  {agent.description}
                </span>
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
