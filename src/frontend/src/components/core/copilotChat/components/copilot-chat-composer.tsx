import {
  CopilotChatInput,
  type CopilotChatInputProps,
  useAgent,
} from "@copilotkit/react-core/v2";
import {
  type ComponentProps,
  createContext,
  forwardRef,
  type KeyboardEvent,
  type RefObject,
  useContext,
  useId,
  useMemo,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import useCopilotChatStore from "@/stores/copilotChatStore";
import { useUtilityStore } from "@/stores/utilityStore";
import { runSlashCommand } from "../helpers/run-slash-command";
import { useComponentMentions } from "../hooks/use-component-mentions";
import { useInputHistory } from "../hooks/use-input-history";
import { useSlashCommands } from "../hooks/use-slash-commands";
import { AssistantMentionPopover } from "./assistant-mention-popover";
import {
  AssistantSlashCommandPopover,
  slashCommandOptionId,
} from "./assistant-slash-command-popover";

type TextAreaProps = ComponentProps<typeof CopilotChatInput.TextArea>;

interface ComposerTextAreaContext {
  /** Returns true when the composer handled the key, so CopilotKit must not. */
  intercept: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  extraProps: Partial<TextAreaProps>;
}

const ComposerContext = createContext<ComposerTextAreaContext | null>(null);

/**
 * CopilotKit's text area with the composer's keys handled first: while a popover
 * is open, Enter and the arrows belong to it, not to "send". A module-level
 * component (not a props object) so CopilotKit keeps its own key and change
 * handlers, which a props-object slot would replace.
 */
const ComposerTextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function ComposerTextArea(props, ref) {
    const composer = useContext(ComposerContext);
    const { onKeyDown, onBlur } = props;
    return (
      <CopilotChatInput.TextArea
        {...props}
        {...composer?.extraProps}
        ref={ref}
        onKeyDown={(event) => {
          if (composer?.intercept(event)) return;
          onKeyDown?.(event);
        }}
        onBlur={(event) => {
          composer?.extraProps.onBlur?.(event);
          onBlur?.(event);
        }}
      />
    );
  },
);

function newMessageId(): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The chat input, as CopilotKit's ``input`` slot. Adds what the previous panel's
 * composer had: ``@`` mentions of canvas components, ``/`` panel commands,
 * Up/Down recall of sent prompts, and the server's message length cap.
 */
export function CopilotChatComposer(props: CopilotChatInputProps) {
  const { t } = useTranslation();
  const { onSubmitMessage, onChange } = props;
  const value = props.value ?? "";
  const agentId = useCopilotChatStore((state) => state.agentId);
  const { agent } = useAgent({ agentId });
  const maxLength = useUtilityStore((state) => state.assistantMaxMessageLength);
  const listboxId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  // CopilotKit owns the text area's ref; reach the element through the wrapper.
  const textareaRef = useMemo(
    () =>
      ({
        get current() {
          return wrapperRef.current?.querySelector("textarea") ?? null;
        },
      }) as RefObject<HTMLTextAreaElement | null>,
    [],
  );

  const setValue = (next: string) => onChange?.(next);
  const mentions = useComponentMentions({ value, setValue, textareaRef });
  const slashCommands = useSlashCommands({
    onComplete: (text) => {
      // Commit now so the caret lands after the completion before the next keystroke.
      flushSync(() => setValue(text));
      textareaRef.current?.setSelectionRange(text.length, text.length);
    },
  });
  const inputHistory = useInputHistory();

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    slashCommands.close();
    mentions.handleValueChange("", 0);
    const acknowledgement = runSlashCommand(trimmed);
    if (acknowledgement !== null) {
      // Shown in the thread like the previous panel did; never sent to the agent.
      agent.addMessages([
        { id: newMessageId(), role: "user", content: trimmed },
        { id: newMessageId(), role: "assistant", content: acknowledgement },
      ]);
      setValue("");
      return;
    }
    inputHistory.push(trimmed);
    onSubmitMessage?.(trimmed);
  };

  const recall = (direction: "up" | "down") => {
    const recalled = inputHistory.recall(direction, value);
    if (recalled === null) return false;
    setValue(recalled);
    requestAnimationFrame(() =>
      textareaRef.current?.setSelectionRange(recalled.length, recalled.length),
    );
    return true;
  };

  const intercept: ComposerTextAreaContext["intercept"] = (event) => {
    if (slashCommands.handleKeyDown(event)) return true;
    if (mentions.handleKeyDown(event)) return true;
    const textarea = event.currentTarget;
    const caret = textarea.selectionStart ?? 0;
    // Recall only from the first or last line, so multi-line drafts keep normal arrows.
    if (event.key === "ArrowUp" && !value.slice(0, caret).includes("\n")) {
      if (recall("up")) {
        event.preventDefault();
        return true;
      }
    }
    if (event.key === "ArrowDown" && !value.slice(caret).includes("\n")) {
      if (recall("down")) {
        event.preventDefault();
        return true;
      }
    }
    return false;
  };

  const activeCommand = slashCommands.isOpen
    ? slashCommands.items[slashCommands.activeIndex]
    : undefined;
  const isAtLimit = value.length >= maxLength;

  return (
    <ComposerContext.Provider
      value={{
        intercept,
        extraProps: {
          maxLength,
          "aria-autocomplete": slashCommands.isOpen ? "list" : undefined,
          "aria-controls": slashCommands.isOpen ? listboxId : undefined,
          "aria-activedescendant": activeCommand
            ? slashCommandOptionId(listboxId, activeCommand.name)
            : undefined,
          onBlur: slashCommands.close,
        },
      }}
    >
      <div ref={wrapperRef} className="relative" data-testid="copilot-composer">
        {slashCommands.isOpen && (
          <AssistantSlashCommandPopover
            listboxId={listboxId}
            items={slashCommands.items}
            activeIndex={slashCommands.activeIndex}
            onHover={slashCommands.setActiveIndex}
            onSelect={slashCommands.complete}
          />
        )}
        {mentions.isOpen && !slashCommands.isOpen && (
          <AssistantMentionPopover
            items={mentions.items}
            activeIndex={mentions.activeIndex}
            onHover={mentions.setActiveIndex}
            onSelect={mentions.confirm}
          />
        )}
        <CopilotChatInput
          {...props}
          value={value}
          onSubmitMessage={submit}
          onChange={(next) => {
            onChange?.(next);
            const caret = textareaRef.current?.selectionStart ?? next.length;
            slashCommands.handleValueChange(next, caret);
            mentions.handleValueChange(next, caret);
          }}
          // No attachments or tools menu: the "+" button would open an empty menu.
          addMenuButton={() => null}
          textArea={ComposerTextArea}
        />
        {isAtLimit && (
          <p
            role="status"
            data-testid="copilot-message-limit"
            className="px-4 pb-2 text-xs text-muted-foreground"
          >
            {t("assistant.messageLimitReached")}
          </p>
        )}
      </div>
    </ComposerContext.Provider>
  );
}
