"""CopilotKit runtime router: the HTTP contract ``@copilotkit/react-core`` speaks.

Multi-route mode of ``@copilotkit/runtime`` 1.79.1:

* ``GET  /info`` lists the agents.
* ``POST /agent/{agent_id}/run`` streams one run as AG-UI events over SSE.
* ``POST /agent/{agent_id}/connect`` resumes a thread; history lives in the
  browser, so there is never anything to resume and the stream ends at once.
* ``POST /agent/{agent_id}/stop/{thread_id}`` stops the thread's run.

The router keeps every stream valid for the client's AG-UI event verifier: it
adds ``RUN_STARTED``/``RUN_FINISHED`` when an agent leaves them out, closes text
messages, tool calls and steps an agent left open, and ends the stream as soon
as Stop is pressed. The client keeps rendering until the server closes the
stream, so a cancelled run must not wait for the agent to notice.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from typing import TYPE_CHECKING, Any

from ag_ui.core import EventType, RunAgentInput, RunErrorEvent, RunFinishedEvent, RunStartedEvent
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from lfx.log.logger import logger
from lfx.services.deps import get_settings_service
from pydantic import BaseModel, ValidationError

from langflow.agentic.api.deps import enforce_agentic_component_admin, require_agentic_experience
from langflow.api.utils.core import CurrentActiveUser  # noqa: TC001 — FastAPI Depends alias needs the runtime symbol
from langflow.copilotkit.agents.base import AgentRunContext, CopilotAgent
from langflow.copilotkit.encoder import KEEP_ALIVE, SSE_HEADERS, SSE_MEDIA_TYPE, encode
from langflow.copilotkit.registry import get_agent, get_agents
from langflow.copilotkit.schemas import AgentInfo, RuntimeInfo, StopRequest

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable
    from uuid import UUID

    from ag_ui.core import BaseEvent

KEEP_ALIVE_SECONDS = 15.0


def require_copilotkit_chat() -> None:
    """404 every runtime route when an operator turned the CopilotKit chat off."""
    if not get_settings_service().settings.copilotkit_chat_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This endpoint is not available")


router = APIRouter(
    prefix="/copilotkit",
    tags=["CopilotKit"],
    include_in_schema=False,
    dependencies=[Depends(require_agentic_experience), Depends(require_copilotkit_chat)],
)


class _ActiveRuns:
    """The cancel event of each thread's in-flight run, keyed by (user, thread).

    Keyed by user so one user can never stop another's run by guessing a thread id.
    Process-local: a Stop that lands on another worker finds nothing, and the run
    ends when its own client disconnects instead.
    """

    def __init__(self) -> None:
        self._runs: dict[tuple[str, str], asyncio.Event] = {}

    def start(self, user_id: UUID, thread_id: str) -> asyncio.Event:
        key = (str(user_id), thread_id)
        previous = self._runs.get(key)
        if previous is not None:
            # One run per thread: a new run supersedes one the client gave up on.
            previous.set()
        cancel = asyncio.Event()
        self._runs[key] = cancel
        return cancel

    def stop(self, user_id: UUID, thread_id: str) -> bool:
        cancel = self._runs.get((str(user_id), thread_id))
        if cancel is None:
            return False
        cancel.set()
        return True

    def finish(self, user_id: UUID, thread_id: str, cancel: asyncio.Event) -> None:
        key = (str(user_id), thread_id)
        if self._runs.get(key) is cancel:
            del self._runs[key]


active_runs = _ActiveRuns()


class _RunEnvelope:
    """Tracks what a run has opened so every stream ends in a state the client accepts."""

    def __init__(self, thread_id: str, run_id: str) -> None:
        self.thread_id = thread_id
        self.run_id = run_id
        self.started = False
        self.closed = False
        self._open_messages: list[str] = []
        self._open_tool_calls: list[str] = []
        self._open_steps: list[str] = []

    def admit(self, event: BaseEvent) -> list[BaseEvent]:
        """The events to send for one agent event, in order."""
        if self.closed:
            logger.debug("Dropping %s after the run ended", event.type)
            return []
        if event.type == EventType.RUN_STARTED:
            if self.started:
                return []
            self.started = True
            return [event]
        out = self._start()
        if event.type == EventType.RUN_FINISHED:
            out += self._close_open()
            self.closed = True
            return [*out, event]
        if event.type == EventType.RUN_ERROR:
            self.closed = True
            return [*out, event]
        self._track(event)
        return [*out, event]

    def finish(self, result: Any = None) -> list[BaseEvent]:
        if self.closed:
            return []
        out = [*self._start(), *self._close_open()]
        out.append(RunFinishedEvent(thread_id=self.thread_id, run_id=self.run_id, result=result))
        self.closed = True
        return out

    def error(self, message: str, code: str | None = None) -> list[BaseEvent]:
        if self.closed:
            return []
        out = self._start()
        out.append(RunErrorEvent(message=message, code=code))
        self.closed = True
        return out

    def _start(self) -> list[BaseEvent]:
        if self.started:
            return []
        self.started = True
        return [RunStartedEvent(thread_id=self.thread_id, run_id=self.run_id)]

    def _track(self, event: BaseEvent) -> None:
        kind = event.type
        if kind == EventType.TEXT_MESSAGE_START:
            self._open_messages.append(event.message_id)  # type: ignore[attr-defined]
        elif kind == EventType.TEXT_MESSAGE_END:
            _discard(self._open_messages, event.message_id)  # type: ignore[attr-defined]
        elif kind == EventType.TOOL_CALL_START:
            self._open_tool_calls.append(event.tool_call_id)  # type: ignore[attr-defined]
        elif kind == EventType.TOOL_CALL_END:
            _discard(self._open_tool_calls, event.tool_call_id)  # type: ignore[attr-defined]
        elif kind == EventType.STEP_STARTED:
            self._open_steps.append(event.step_name)  # type: ignore[attr-defined]
        elif kind == EventType.STEP_FINISHED:
            _discard(self._open_steps, event.step_name)  # type: ignore[attr-defined]

    def _close_open(self) -> list[BaseEvent]:
        from ag_ui.core import StepFinishedEvent, TextMessageEndEvent, ToolCallEndEvent

        out: list[BaseEvent] = [TextMessageEndEvent(message_id=m) for m in self._open_messages]
        out += [ToolCallEndEvent(tool_call_id=t) for t in self._open_tool_calls]
        out += [StepFinishedEvent(step_name=s) for s in reversed(self._open_steps)]
        self._open_messages.clear()
        self._open_tool_calls.clear()
        self._open_steps.clear()
        return out


def _discard(items: list[str], item: str) -> None:
    with contextlib.suppress(ValueError):
        items.remove(item)


def _error_message(exc: BaseException) -> str:
    if isinstance(exc, HTTPException):
        return str(exc.detail)
    return str(exc) or type(exc).__name__


async def stream_run(
    agent: CopilotAgent,
    run_input: RunAgentInput,
    ctx: AgentRunContext,
    *,
    on_done: Callable[[], None] | None = None,
    keep_alive_seconds: float = KEEP_ALIVE_SECONDS,
) -> AsyncIterator[str]:
    """Run ``agent`` and yield its events as SSE frames, wrapped in a valid run envelope."""
    envelope = _RunEnvelope(run_input.thread_id, run_input.run_id)
    queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

    async def pump() -> None:
        try:
            async for agent_event in agent.run(run_input, ctx):
                await queue.put(("event", agent_event))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - reported to the client as RUN_ERROR
            logger.warning("CopilotKit agent %r failed", agent.id, exc_info=True)
            await queue.put(("error", exc))
        else:
            await queue.put(("done", None))

    agent_task = asyncio.create_task(pump())
    cancelled = asyncio.create_task(ctx.cancel.wait())
    next_item: asyncio.Task[tuple[str, Any]] | None = None
    try:
        while not envelope.closed:
            pending_item = next_item if next_item is not None else asyncio.create_task(queue.get())
            next_item = pending_item
            done, _ = await asyncio.wait(
                {pending_item, cancelled}, timeout=keep_alive_seconds, return_when=asyncio.FIRST_COMPLETED
            )
            if pending_item in done:
                kind, payload = pending_item.result()
                next_item = None
                if kind == "event":
                    events = envelope.admit(payload)
                elif kind == "error":
                    events = envelope.error(_error_message(payload))
                else:
                    events = envelope.finish()
                for event in events:
                    yield encode(event)
                continue
            if cancelled in done:
                for event in envelope.finish(result={"outcome": "cancelled"}):
                    yield encode(event)
                break
            if await ctx.is_disconnected():
                ctx.cancel.set()
                continue
            yield KEEP_ALIVE
    finally:
        for task in (agent_task, cancelled, next_item):
            if task is not None and not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        if on_done is not None:
            on_done()


def _resolve_agent(agent_id: str) -> CopilotAgent:
    agent = get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent '{agent_id}' not found")
    return agent


def _check_agent_access(agent: CopilotAgent, user: Any) -> None:
    if agent.executes_component_code:
        enforce_agentic_component_admin(is_superuser=bool(user.is_superuser))


async def _parse_body(request: Request, model: type[BaseModel], *, optional: bool = False) -> Any:
    raw = await request.body()
    if optional and not raw.strip():
        return model()
    try:
        return model.model_validate(json.loads(raw))
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid request body") from exc


@router.get("/info")
async def runtime_info(current_user: CurrentActiveUser) -> dict[str, Any]:
    del current_user
    agents = {
        agent_id: AgentInfo(name=agent.name, description=agent.description, class_name=type(agent).__name__)
        for agent_id, agent in get_agents().items()
    }
    return RuntimeInfo(agents=agents).model_dump(by_alias=True)


@router.post("/agent/{agent_id}/run")
async def run_agent(agent_id: str, request: Request, current_user: CurrentActiveUser) -> StreamingResponse:
    agent = _resolve_agent(agent_id)
    _check_agent_access(agent, current_user)
    run_input: RunAgentInput = await _parse_body(request, RunAgentInput)

    cancel = active_runs.start(current_user.id, run_input.thread_id)
    ctx = AgentRunContext(
        user_id=current_user.id,
        is_superuser=bool(current_user.is_superuser),
        is_disconnected=request.is_disconnected,
        cancel=cancel,
    )
    return StreamingResponse(
        stream_run(
            agent,
            run_input,
            ctx,
            on_done=lambda: active_runs.finish(current_user.id, run_input.thread_id, cancel),
        ),
        media_type=SSE_MEDIA_TYPE,
        headers=SSE_HEADERS,
    )


@router.post("/agent/{agent_id}/connect")
async def connect_agent(agent_id: str, request: Request, current_user: CurrentActiveUser) -> Response:
    _check_agent_access(_resolve_agent(agent_id), current_user)
    await _parse_body(request, RunAgentInput)
    # Thread history is kept in the browser, so there is never a server-side run
    # to resume. An empty stream tells the client exactly that.
    return Response(content=b"", media_type=SSE_MEDIA_TYPE, headers=SSE_HEADERS)


@router.post("/agent/{agent_id}/stop/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
async def stop_agent(agent_id: str, thread_id: str, request: Request, current_user: CurrentActiveUser) -> Response:
    _resolve_agent(agent_id)
    await _parse_body(request, StopRequest, optional=True)
    active_runs.stop(current_user.id, thread_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
