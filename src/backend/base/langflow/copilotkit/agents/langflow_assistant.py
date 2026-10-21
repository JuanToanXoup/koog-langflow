"""The ``langflow`` agent: the Langflow Assistant."""

from __future__ import annotations

from typing import TYPE_CHECKING

from langflow.copilotkit.agents.base import AgentRunContext, CopilotAgent

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from ag_ui.core import BaseEvent, RunAgentInput


class LangflowAssistantAgent(CopilotAgent):
    """Builds and edits the open flow, and answers questions about Langflow."""

    id = "langflow"
    name = "Langflow Assistant"
    description = "Builds and edits the open flow, generates components, and answers questions about Langflow."
    executes_component_code = True

    async def run(self, run_input: RunAgentInput, ctx: AgentRunContext) -> AsyncIterator[BaseEvent]:
        del run_input, ctx
        return
        yield
