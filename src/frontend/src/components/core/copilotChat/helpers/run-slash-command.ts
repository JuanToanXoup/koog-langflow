import useCopilotChatStore from "@/stores/copilotChatStore";
import { parseHistoryCommand } from "./history-storage";
import { parseIterationsCommand } from "./iterations-storage";

const SKIP_ALL_COMMAND = "/skip-all";

/**
 * Run a panel command (``/skip-all``, ``/history N``, ``/iterations N``) and
 * return the acknowledgement to show, or null when the text is a prompt.
 *
 * The commands change panel settings only; they are never sent to an agent.
 * ``/history`` and ``/iterations`` reach the assistant as ``forwardedProps``.
 */
export function runSlashCommand(text: string): string | null {
  const trimmed = text.trim();
  const store = useCopilotChatStore.getState();

  // Exact match only: "/skip-all please" is a real prompt.
  if (trimmed === SKIP_ALL_COMMAND) {
    const next = !store.skipAll;
    store.setSkipAll(next);
    return next
      ? "Skip-all mode enabled. Plans and flow proposals will be approved automatically."
      : "Skip-all mode disabled. Plans and flow proposals will wait for your Continue click.";
  }

  const history = parseHistoryCommand(trimmed, store.historyLimit);
  if (history) {
    if (history.changed) store.setHistoryLimit(history.limit);
    return history.announcement;
  }

  const iterations = parseIterationsCommand(trimmed, store.iterationsLimit);
  if (iterations) {
    if (iterations.changed) store.setIterationsLimit(iterations.limit);
    return iterations.announcement;
  }

  return null;
}
