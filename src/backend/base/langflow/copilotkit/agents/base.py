"""CopilotKit agent base class.

An agent turns one AG-UI ``RunAgentInput`` into a stream of AG-UI events. The
runtime router owns the transport: it wraps the stream in ``RUN_STARTED`` /
``RUN_FINISHED`` when the agent leaves them out, closes anything the agent left
open, honours ``/stop``, and turns an exception into ``RUN_ERROR``. An agent
only has to yield what it has to say.
"""

from __future__ import annotations

import asyncio
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, ClassVar

from lfx.services.deps import session_scope

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable
    from contextlib import AbstractAsyncContextManager
    from uuid import UUID

    from ag_ui.core import BaseEvent, RunAgentInput
    from sqlalchemy.ext.asyncio import AsyncSession

AGENT_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
"""Agent ids are URL path segments (``/agent/{id}/run``), so they stay lowercase slugs."""


async def _never_disconnected() -> bool:
    return False


@dataclass
class AgentRunContext:
    """Per-run state an agent may read.

    ``session_scope`` opens a short-lived database session. The run outlives the
    request's own session (the response streams after the handler returns), and
    holding one connection for a whole model run starves the pool (#14445), so an
    agent opens a session only around the queries that need one.
    """

    user_id: UUID
    is_superuser: bool = False
    is_disconnected: Callable[[], Awaitable[bool]] = _never_disconnected
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    session_scope: Callable[[], AbstractAsyncContextManager[AsyncSession]] = session_scope

    async def cancelled(self) -> bool:
        """True once the user pressed Stop or the client went away."""
        if self.cancel.is_set():
            return True
        return await self.is_disconnected()


class CopilotAgent(ABC):
    """A chat agent the CopilotKit panel can talk to.

    Subclasses set ``id`` (the URL slug), ``name`` (shown in the agent picker)
    and ``description``. ``executes_component_code`` marks agents that generate
    and run component code in-process; the router applies the custom-component
    admin policy to those before the run starts.
    """

    id: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str] = ""
    executes_component_code: ClassVar[bool] = False

    @abstractmethod
    def run(self, run_input: RunAgentInput, ctx: AgentRunContext) -> AsyncIterator[BaseEvent]:
        """Yield the AG-UI events for one run."""
