"""``/api/v1/copilotkit``: the CopilotKit runtime contract the React chat panel speaks.

The client (``@copilotkit/react-core`` 1.79.1) reads ``/info`` to find agents, posts
AG-UI ``RunAgentInput`` to ``/agent/{id}/run`` and reads AG-UI events back over SSE,
and verifies the event stream: a run must open with ``RUN_STARTED`` and close every
message, tool call and step before ``RUN_FINISHED``.
"""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from ag_ui.core import (
    CustomEvent,
    RunAgentInput,
    StepStartedEvent,
    TextMessageContentEvent,
    TextMessageStartEvent,
)
from fastapi import status
from langflow.copilotkit import registry
from langflow.copilotkit.agents.base import AgentRunContext, CopilotAgent
from langflow.copilotkit.api import active_runs, stream_run
from langflow.copilotkit.encoder import text_message, tool_call

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from ag_ui.core import BaseEvent
    from httpx import AsyncClient

BASE = "api/v1/copilotkit"

INFO_KEYS = {
    "version",
    "agents",
    "mode",
    "threadEndpoints",
    "suggestions",
    "audioFileTranscriptionEnabled",
    "a2uiEnabled",
    "openGenerativeUIEnabled",
    "telemetryDisabled",
}


class EchoAgent(CopilotAgent):
    """Says back the last user message, then calls a frontend tool."""

    id = "echo"
    name = "Echo"
    description = "Echoes the last user message."

    async def run(self, run_input: RunAgentInput, ctx: AgentRunContext) -> AsyncIterator[BaseEvent]:
        del ctx
        text = next(m.content for m in reversed(run_input.messages) if m.role == "user")
        for event in text_message("m1", f"echo: {text}"):
            yield event
        for event in tool_call("t1", "apply_flow_update", {"value": {"action": "noop"}}):
            yield event


class LeaksOpenEventsAgent(CopilotAgent):
    """Starts a message and a step and never closes them."""

    id = "leaky"
    name = "Leaky"

    async def run(self, run_input: RunAgentInput, ctx: AgentRunContext) -> AsyncIterator[BaseEvent]:
        del run_input, ctx
        yield StepStartedEvent(step_name="thinking")
        yield TextMessageStartEvent(message_id="m1", role="assistant")
        yield TextMessageContentEvent(message_id="m1", delta="partial")


class FailingAgent(CopilotAgent):
    id = "failing"
    name = "Failing"

    async def run(self, run_input: RunAgentInput, ctx: AgentRunContext) -> AsyncIterator[BaseEvent]:
        del run_input, ctx
        yield CustomEvent(name="before", value=1)
        msg = "model exploded"
        raise RuntimeError(msg)


class WaitsForStopAgent(CopilotAgent):
    id = "slow"
    name = "Slow"

    def __init__(self) -> None:
        self.saw_cancel = asyncio.Event()

    async def run(self, run_input: RunAgentInput, ctx: AgentRunContext) -> AsyncIterator[BaseEvent]:
        del run_input, ctx
        yield TextMessageStartEvent(message_id="m1", role="assistant")
        yield TextMessageContentEvent(message_id="m1", delta="working")
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            self.saw_cancel.set()
            raise


class AdminOnlyAgent(EchoAgent):
    id = "codegen"
    name = "Codegen"
    executes_component_code = True


@pytest.fixture
def agentic_enabled(client):  # noqa: ARG001 — the app must exist first
    from langflow.services.deps import get_settings_service

    settings = get_settings_service().settings
    original = settings.agentic_experience
    settings.agentic_experience = True
    yield
    settings.agentic_experience = original


@pytest.fixture(autouse=True)
def test_agents():
    registry.reset_registry()
    for agent in (EchoAgent(), LeaksOpenEventsAgent(), FailingAgent(), AdminOnlyAgent()):
        registry.register(agent)
    yield
    registry.reset_registry()


def _run_body(text: str = "hello", thread_id: str = "thread-1") -> dict:
    return {
        "threadId": thread_id,
        "runId": "run-1",
        "protocolVersion": "1.0",
        "state": {},
        "messages": [{"id": "u1", "role": "user", "content": text}],
        "tools": [],
        "context": [],
        "forwardedProps": {"flow_id": "f1"},
    }


def _sse_events(body: str) -> list[dict]:
    return [json.loads(line[5:].strip()) for line in body.splitlines() if line.startswith("data:")]


def _types(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


@pytest.mark.usefixtures("agentic_enabled")
class TestInfo:
    async def test_should_answer_the_runtime_info_shape(self, client: AsyncClient, logged_in_headers):
        response = await client.get(f"{BASE}/info", headers=logged_in_headers)

        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert set(body) == INFO_KEYS
        assert body["version"] == "1.79.1"
        assert body["mode"] == "sse"
        assert body["threadEndpoints"] == {
            "list": False,
            "inspect": False,
            "mutations": False,
            "realtimeMetadata": False,
        }
        assert body["suggestions"] is False
        assert body["audioFileTranscriptionEnabled"] is False
        assert body["a2uiEnabled"] is False
        assert body["openGenerativeUIEnabled"] is False
        assert body["telemetryDisabled"] is True

    async def test_should_list_registered_agents(self, client: AsyncClient, logged_in_headers):
        body = (await client.get(f"{BASE}/info", headers=logged_in_headers)).json()

        assert body["agents"]["echo"] == {
            "name": "Echo",
            "description": "Echoes the last user message.",
            "className": "EchoAgent",
        }

    async def test_should_reject_unauthenticated(self, client: AsyncClient):
        response = await client.get(f"{BASE}/info")
        assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)


class TestGate:
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", "info"),
            ("post", "agent/echo/run"),
            ("post", "agent/echo/connect"),
            ("post", "agent/echo/stop/thread-1"),
        ],
    )
    async def test_should_404_every_route_when_the_agentic_experience_is_off(
        self, client: AsyncClient, logged_in_headers, monkeypatch, method, path
    ):
        from langflow.services.deps import get_settings_service

        monkeypatch.setattr(get_settings_service().settings, "agentic_experience", False)

        kwargs = {"json": _run_body()} if method == "post" else {}
        response = await getattr(client, method)(f"{BASE}/{path}", headers=logged_in_headers, **kwargs)

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.usefixtures("agentic_enabled")
    async def test_should_404_when_the_copilotkit_chat_is_off(
        self, client: AsyncClient, logged_in_headers, monkeypatch
    ):
        from langflow.services.deps import get_settings_service

        monkeypatch.setattr(get_settings_service().settings, "copilotkit_chat_enabled", False)

        info = await client.get(f"{BASE}/info", headers=logged_in_headers)
        run = await client.post(f"{BASE}/agent/echo/run", headers=logged_in_headers, json=_run_body())

        assert info.status_code == status.HTTP_404_NOT_FOUND
        assert run.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.usefixtures("agentic_enabled")
class TestRun:
    async def test_should_wrap_the_agent_events_in_a_run(self, client: AsyncClient, logged_in_headers):
        response = await client.post(f"{BASE}/agent/echo/run", headers=logged_in_headers, json=_run_body("hi"))

        assert response.status_code == status.HTTP_200_OK
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache"
        events = _sse_events(response.text)
        assert _types(events) == [
            "RUN_STARTED",
            "TEXT_MESSAGE_START",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_END",
            "TOOL_CALL_START",
            "TOOL_CALL_ARGS",
            "TOOL_CALL_END",
            "RUN_FINISHED",
        ]
        assert events[0] == {"type": "RUN_STARTED", "threadId": "thread-1", "runId": "run-1"}
        assert events[2]["delta"] == "echo: hi"
        assert events[4]["toolCallName"] == "apply_flow_update"
        assert json.loads(events[5]["delta"]) == {"value": {"action": "noop"}}
        assert events[-1] == {"type": "RUN_FINISHED", "threadId": "thread-1", "runId": "run-1"}

    async def test_should_close_what_the_agent_left_open(self, client: AsyncClient, logged_in_headers):
        response = await client.post(f"{BASE}/agent/leaky/run", headers=logged_in_headers, json=_run_body())

        assert _types(_sse_events(response.text)) == [
            "RUN_STARTED",
            "STEP_STARTED",
            "TEXT_MESSAGE_START",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_END",
            "STEP_FINISHED",
            "RUN_FINISHED",
        ]

    async def test_should_turn_an_agent_exception_into_run_error(self, client: AsyncClient, logged_in_headers):
        response = await client.post(f"{BASE}/agent/failing/run", headers=logged_in_headers, json=_run_body())

        events = _sse_events(response.text)
        assert _types(events) == ["RUN_STARTED", "CUSTOM", "RUN_ERROR"]
        assert events[-1]["message"] == "model exploded"

    async def test_should_404_an_unknown_agent(self, client: AsyncClient, logged_in_headers):
        response = await client.post(f"{BASE}/agent/nope/run", headers=logged_in_headers, json=_run_body())
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.parametrize("body", [b"not json", b'{"threadId": "t"}', b""])
    async def test_should_400_an_invalid_body(self, client: AsyncClient, logged_in_headers, body):
        response = await client.post(
            f"{BASE}/agent/echo/run",
            headers={**logged_in_headers, "content-type": "application/json"},
            content=body,
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    async def test_should_reject_unauthenticated(self, client: AsyncClient):
        response = await client.post(f"{BASE}/agent/echo/run", json=_run_body())
        assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    async def test_should_apply_the_component_admin_policy_to_code_executing_agents(
        self, client: AsyncClient, logged_in_headers, monkeypatch
    ):
        monkeypatch.setattr("langflow.agentic.api.deps.admin_only_build_required", lambda **_: True)

        blocked = await client.post(f"{BASE}/agent/codegen/run", headers=logged_in_headers, json=_run_body())
        allowed = await client.post(f"{BASE}/agent/echo/run", headers=logged_in_headers, json=_run_body())

        assert blocked.status_code == status.HTTP_403_FORBIDDEN
        assert allowed.status_code == status.HTTP_200_OK

    async def test_should_forget_the_run_once_it_ends(self, client: AsyncClient, logged_in_headers, active_user):
        await client.post(f"{BASE}/agent/echo/run", headers=logged_in_headers, json=_run_body(thread_id="t-done"))

        assert active_runs.stop(active_user.id, "t-done") is False


@pytest.mark.usefixtures("agentic_enabled")
class TestConnect:
    async def test_should_answer_an_empty_stream(self, client: AsyncClient, logged_in_headers):
        response = await client.post(f"{BASE}/agent/echo/connect", headers=logged_in_headers, json=_run_body())

        assert response.status_code == status.HTTP_200_OK
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.content == b""

    async def test_should_404_an_unknown_agent(self, client: AsyncClient, logged_in_headers):
        response = await client.post(f"{BASE}/agent/nope/connect", headers=logged_in_headers, json=_run_body())
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.usefixtures("agentic_enabled")
class TestStop:
    async def test_should_set_the_runs_cancel_event(self, client: AsyncClient, logged_in_headers, active_user):
        cancel = active_runs.start(active_user.id, "thread-stop")
        try:
            response = await client.post(
                f"{BASE}/agent/echo/stop/thread-stop", headers=logged_in_headers, json={"runId": "run-1"}
            )
        finally:
            active_runs.finish(active_user.id, "thread-stop", cancel)

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert cancel.is_set()

    async def test_should_accept_an_empty_body(self, client: AsyncClient, logged_in_headers):
        response = await client.post(f"{BASE}/agent/echo/stop/no-such-thread", headers=logged_in_headers)
        assert response.status_code == status.HTTP_204_NO_CONTENT

    async def test_should_not_stop_another_users_run(self, client: AsyncClient, logged_in_headers):
        cancel = active_runs.start(uuid4(), "shared-thread")
        try:
            await client.post(f"{BASE}/agent/echo/stop/shared-thread", headers=logged_in_headers)
        finally:
            active_runs.finish(uuid4(), "shared-thread", cancel)

        assert not cancel.is_set()

    async def test_should_400_an_invalid_body(self, client: AsyncClient, logged_in_headers):
        response = await client.post(
            f"{BASE}/agent/echo/stop/thread-1", headers=logged_in_headers, json={"unexpected": True}
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


class TestStreamRun:
    """``stream_run`` without HTTP: cancellation and keep-alives need control over timing."""

    @staticmethod
    def _input() -> RunAgentInput:
        return RunAgentInput.model_validate(_run_body())

    async def test_should_end_the_stream_promptly_when_stopped(self):
        agent = WaitsForStopAgent()
        ctx = AgentRunContext(user_id=uuid4())
        frames: list[str] = []

        async def consume():
            async for frame in stream_run(agent, self._input(), ctx):
                frames.append(frame)
                if '"working"' in frame:
                    ctx.cancel.set()

        await asyncio.wait_for(consume(), timeout=5)

        events = _sse_events("".join(frames))
        assert _types(events) == [
            "RUN_STARTED",
            "TEXT_MESSAGE_START",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_END",
            "RUN_FINISHED",
        ]
        assert events[-1]["result"] == {"outcome": "cancelled"}
        assert agent.saw_cancel.is_set()

    async def test_should_send_keep_alives_while_the_agent_is_quiet(self):
        agent = WaitsForStopAgent()
        ctx = AgentRunContext(user_id=uuid4())
        frames: list[str] = []

        async def consume():
            async for frame in stream_run(agent, self._input(), ctx, keep_alive_seconds=0.01):
                frames.append(frame)
                if frames.count(": keep-alive\n\n") == 2:
                    ctx.cancel.set()

        await asyncio.wait_for(consume(), timeout=5)

        assert frames.count(": keep-alive\n\n") == 2

    async def test_should_cancel_when_the_client_disconnects(self):
        agent = WaitsForStopAgent()

        async def gone() -> bool:
            return True

        ctx = AgentRunContext(user_id=uuid4(), is_disconnected=gone)
        frames = [frame async for frame in stream_run(agent, self._input(), ctx, keep_alive_seconds=0.01)]

        assert ctx.cancel.is_set()
        assert _sse_events("".join(frames))[-1]["result"] == {"outcome": "cancelled"}

    async def test_should_call_on_done(self):
        done = []
        ctx = AgentRunContext(user_id=uuid4())

        _ = [f async for f in stream_run(EchoAgent(), self._input(), ctx, on_done=lambda: done.append(True))]

        assert done == [True]
