/**
 * Jest stand-in for `@copilotkit/react-core/v2` (mapped in jest.config.js).
 *
 * The real entry point is a large ESM bundle (lit, katex, streamdown, a
 * websandbox) that Jest's CommonJS runtime cannot load, and Langflow's tests
 * exercise Langflow's wiring, not CopilotKit. This mock keeps the surface the
 * assistant chat uses: the provider and chat components render their props
 * for assertions, agents are plain message holders, and tool registrations
 * are recorded so tests can call a handler or render a card directly.
 */
import {
  type ComponentType,
  forwardRef,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

export type MockMessage = {
  id: string;
  role: string;
  content?: unknown;
  toolCalls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  toolCallId?: string;
};

type Subscriber = {
  onMessagesChanged?: (params: { messages: MockMessage[] }) => void;
  onCustomEvent?: (params: { event: { name: string; value: unknown } }) => void;
  onRunStartedEvent?: () => void;
  onRunFinalized?: () => void;
  onRunFailed?: () => void;
};

export class MockAgent {
  agentId: string;
  threadId = "mock-thread";
  messages: MockMessage[] = [];
  isRunning = false;
  abortRun = jest.fn();
  private subscribers = new Set<Subscriber>();

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  setMessages(messages: MockMessage[]) {
    this.messages = [...messages];
    for (const s of this.subscribers)
      s.onMessagesChanged?.({ messages: this.messages });
  }

  addMessage(message: MockMessage) {
    this.setMessages([...this.messages, message]);
  }

  addMessages(messages: MockMessage[]) {
    this.setMessages([...this.messages, ...messages]);
  }

  subscribe(subscriber: Subscriber) {
    this.subscribers.add(subscriber);
    return { unsubscribe: () => this.subscribers.delete(subscriber) };
  }

  /** Test helper: deliver an AG-UI CUSTOM event to subscribers. */
  emitCustomEvent(name: string, value: unknown) {
    for (const s of this.subscribers)
      s.onCustomEvent?.({ event: { name, value } });
  }

  /** Test helper: flip the run state the way a run start/end would. */
  setRunning(running: boolean) {
    this.isRunning = running;
    for (const s of this.subscribers)
      running ? s.onRunStartedEvent?.() : s.onRunFinalized?.();
  }
}

const agents = new Map<string, MockAgent>();

export function __getMockAgent(agentId: string): MockAgent {
  let agent = agents.get(agentId);
  if (!agent) {
    agent = new MockAgent(agentId);
    agents.set(agentId, agent);
  }
  return agent;
}

export const mockCopilotKit = {
  runAgent: jest.fn(async () => ({ newMessages: [] })),
  stopAgent: jest.fn(),
};

type RegisteredTool = {
  name: string;
  handler?: (args: Record<string, unknown>) => unknown;
  render?: ComponentType<Record<string, unknown>>;
  followUp?: boolean;
  [key: string]: unknown;
};

export const __registeredTools = new Map<string, RegisteredTool>();
export const __registeredRenderers = new Map<string, RegisteredTool>();
export const __lastProps: {
  provider?: Record<string, unknown>;
  chat?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
} = {};

export function __resetCopilotKitMock() {
  agents.clear();
  __registeredTools.clear();
  __registeredRenderers.clear();
  delete __lastProps.provider;
  delete __lastProps.chat;
  delete __lastProps.configuration;
  mockCopilotKit.runAgent.mockClear();
  mockCopilotKit.stopAgent.mockClear();
}

export function CopilotKitProvider({
  children,
  ...props
}: {
  children?: ReactNode;
  [key: string]: unknown;
}) {
  __lastProps.provider = props;
  return <div data-testid="copilotkit-provider">{children}</div>;
}

export function CopilotChatConfigurationProvider({
  children,
  ...props
}: {
  children?: ReactNode;
  [key: string]: unknown;
}) {
  __lastProps.configuration = props;
  return (
    <div
      data-testid="copilot-chat-configuration"
      data-thread-id={String(props.threadId ?? "")}
      data-agent-id={String(props.agentId ?? "")}
    >
      {children}
    </div>
  );
}

export function CopilotChat(props: Record<string, unknown>) {
  __lastProps.chat = props;
  return (
    <div data-testid="copilot-chat" data-agent-id={String(props.agentId)} />
  );
}

const MockTextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function MockTextArea(props, ref) {
  return <textarea data-testid="copilot-chat-textarea" ref={ref} {...props} />;
});

/**
 * Renders the ``textArea`` slot the way CopilotKit does: a component slot gets
 * CopilotKit's own handlers (Enter sends), which it may wrap.
 */
export function CopilotChatInput({
  onSubmitMessage,
  value,
  onChange,
  textArea,
}: {
  onSubmitMessage?: (value: string) => void;
  value?: string;
  onChange?: (value: string) => void;
  textArea?:
    | ComponentType<TextareaHTMLAttributes<HTMLTextAreaElement>>
    | object;
  [key: string]: unknown;
}) {
  // Same test CopilotKit's renderSlot uses: functions and forwardRef/memo objects.
  const isComponent =
    typeof textArea === "function" ||
    (typeof textArea === "object" &&
      textArea !== null &&
      "$$typeof" in textArea);
  const TextArea = (isComponent ? textArea : MockTextArea) as ComponentType<
    TextareaHTMLAttributes<HTMLTextAreaElement>
  >;
  const send = () => {
    const trimmed = (value ?? "").trim();
    if (trimmed) onSubmitMessage?.(trimmed);
  };
  return (
    <div data-testid="copilot-chat-input">
      <TextArea
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button type="button" data-testid="copilot-chat-send" onClick={send}>
        send
      </button>
    </div>
  );
}
CopilotChatInput.TextArea = MockTextArea;

export function useAgent({ agentId }: { agentId?: string } = {}) {
  return { agent: __getMockAgent(agentId ?? "default"), isReady: true };
}

export function useCopilotKit() {
  return { copilotkit: mockCopilotKit };
}

export const useFrontendTool = jest.fn((tool: RegisteredTool) => {
  __registeredTools.set(tool.name, tool);
});

export const useHumanInTheLoop = jest.fn((tool: RegisteredTool) => {
  __registeredTools.set(tool.name, tool);
});

export const useRenderTool = jest.fn((config: RegisteredTool) => {
  __registeredRenderers.set(config.name, config);
});

export const useDefaultRenderTool = jest.fn();
export const useAgentContext = jest.fn();
