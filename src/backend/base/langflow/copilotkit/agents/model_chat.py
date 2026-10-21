"""The ``chat`` agent: plain chat with the user's model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from langflow.copilotkit.agents.base import AgentRunContext, CopilotAgent

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from ag_ui.core import BaseEvent, RunAgentInput


class ModelChatAgent(CopilotAgent):
    """Talks to the user's default model directly, with no tools."""

    id = "chat"
    name = "Chat"
    description = "Chat with your default model. No tools, no canvas access."

    async def run(self, run_input: RunAgentInput, ctx: AgentRunContext) -> AsyncIterator[BaseEvent]:
        del run_input, ctx
        return
        yield
