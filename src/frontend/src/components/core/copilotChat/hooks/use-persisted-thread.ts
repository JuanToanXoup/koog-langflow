import { useAgent } from "@copilotkit/react-core/v2";
import { useLayoutEffect } from "react";
import {
  loadThreadMessages,
  saveThreadMessages,
} from "../helpers/thread-storage";

const SAVE_DELAY_MS = 400;

/**
 * Bind the shared CopilotKit agent to this flow's thread and keep its
 * transcript in ``localStorage``.
 *
 * CopilotKit keeps a thread's messages only for the page's lifetime, so a
 * reload would otherwise land in an empty chat. On a thread switch this
 * restores the saved transcript; after that every change is saved (debounced
 * while tokens stream, immediately when a run ends). The binding lives in the
 * always-mounted panel rather than the chat view, so a run that finishes while
 * the panel is closed is still saved, and reopening never replaces newer
 * in-memory messages with an older saved copy.
 */
export function usePersistedThread(agentId: string, threadId?: string) {
  const { agent, isReady } = useAgent({ agentId });

  useLayoutEffect(() => {
    // Until /info resolves the agent is a provisional stand-in that is about
    // to be replaced; binding it would only be thrown away.
    if (!isReady || !threadId) return;

    if (agent.threadId !== threadId || agent.messages.length === 0) {
      agent.threadId = threadId;
      agent.setMessages(loadThreadMessages(agentId, threadId));
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = undefined;
      if (agent.threadId === threadId && agent.messages.length > 0) {
        saveThreadMessages(agentId, threadId, agent.messages);
      }
    };
    const subscription = agent.subscribe({
      onMessagesChanged: () => {
        clearTimeout(timer);
        timer = setTimeout(save, SAVE_DELAY_MS);
      },
      onRunFinalized: () => save(),
      onRunFailed: () => save(),
    });
    return () => {
      subscription.unsubscribe();
      save();
    };
  }, [agent, isReady, agentId, threadId]);

  return { agent, isReady };
}
