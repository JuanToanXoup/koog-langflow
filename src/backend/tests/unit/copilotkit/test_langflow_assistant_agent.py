"""The ``langflow`` agent: assistant SSE → AG-UI translation, turn planning, and ``/run`` end to end."""

from __future__ import annotations

import itertools
import json
from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import pytest
from ag_ui.core import RunAgentInput
from fastapi import HTTPException, status
from langflow.agentic.services.flow_types import EDIT_CONTINUATION_INPUT, PLAN_APPROVAL_INPUT
from langflow.copilotkit import registry
from langflow.copilotkit.agents.langflow_assistant import (
    OPEN_A_FLOW_MESSAGE,
    AssistantEventTranslator,
    LangflowAssistantAgent,
    build_refinement_input,
    parse_sse_payloads,
    session_id_for,
    turn_input,
)

if TYPE_CHECKING:
    from httpx import AsyncClient

FLOW_ID = "11111111-1111-4111-8111-111111111111"


def _sse(**payload) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _translator() -> AssistantEventTranslator:
    ids = itertools.count(1)
    return AssistantEventTranslator("thread-1", "run-1", new_id=lambda: f"id{next(ids)}")


def _translate(*frames: str) -> list:
    translator = _translator()
    events = []
    for frame in frames:
        for payload in parse_sse_payloads(frame):
            events += translator.translate(payload)
    return events + translator.finish()


def _summary(events: list) -> list[str]:
    """Event types, with the tool or custom event name where there is one."""
    out = []
    for event in events:
        name = getattr(event, "tool_call_name", None) or getattr(event, "name", None)
        kind = event.type.value
        out.append(f"{kind}:{name}" if name else kind)
    return out


def _tool_args(events: list, name: str) -> dict:
    start = next(e for e in events if getattr(e, "tool_call_name", None) == name)
    args = next(e for e in events if e.type == "TOOL_CALL_ARGS" and e.tool_call_id == start.tool_call_id)
    return json.loads(args.delta)


class TestTranslator:
    def test_should_translate_a_qa_turn(self):
        events = _translate(
            _sse(event="progress", step="generating", attempt=1, max_attempts=3),
            _sse(event="token", chunk="Hello"),
            _sse(event="token", chunk=" world"),
            _sse(
                event="complete",
                data={"result": "Hello world", "usage": {"total_tokens": 12}, "duration_seconds": 1.5},
            ),
        )

        assert _summary(events) == [
            "STEP_STARTED",
            "CUSTOM:langflow.progress",
            "TEXT_MESSAGE_START",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_END",
            "CUSTOM:langflow.complete",
            "TOOL_CALL_START:show_turn_summary",
            "TOOL_CALL_ARGS",
            "TOOL_CALL_END",
            "STEP_FINISHED",
        ]
        assert [e.delta for e in events if e.type == "TEXT_MESSAGE_CONTENT"] == ["Hello", " world"]
        assert _tool_args(events, "show_turn_summary") == {"usage": {"total_tokens": 12}, "duration_seconds": 1.5}

    def test_should_send_the_result_when_nothing_streamed(self):
        events = _translate(_sse(event="complete", data={"result": "Done."}))

        assert _summary(events)[:3] == ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]
        assert events[1].delta == "Done."

    def test_should_apply_incremental_canvas_changes_as_they_stream(self):
        add = {"event": "flow_update", "action": "add_component", "node": {"id": "n1"}}
        events = _translate(
            _sse(event="tool_start", tool="add_component", label="Adding ChatInput"),
            _sse(**add),
            _sse(event="complete", data={"result": "Added."}),
        )

        assert _summary(events)[:4] == [
            "CUSTOM:langflow.tool_start",
            "TOOL_CALL_START:apply_flow_update",
            "TOOL_CALL_ARGS",
            "TOOL_CALL_END",
        ]
        assert _tool_args(events, "apply_flow_update") == {"value": add}

    def test_should_close_text_before_a_tool_call_and_group_under_one_message(self):
        events = _translate(
            _sse(event="token", chunk="Adding it."),
            _sse(event="flow_update", action="connect", edge={"source": "a", "target": "b"}),
            _sse(event="token", chunk="Done."),
        )

        assert _summary(events) == [
            "TEXT_MESSAGE_START",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_END",
            "TOOL_CALL_START:apply_flow_update",
            "TOOL_CALL_ARGS",
            "TOOL_CALL_END",
            "TEXT_MESSAGE_START",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_END",
        ]
        first_message = events[0].message_id
        assert events[3].parent_message_id == first_message
        assert events[6].message_id != first_message

    def test_should_gate_a_flow_replacement_and_carry_later_updates(self):
        flow = {"name": "Chat", "data": {"nodes": [{"id": "a"}, {"id": "b"}], "edges": [{"id": "e"}]}}
        tail = {"event": "flow_update", "action": "configure", "component_id": "a", "params": {"x": 1}}
        events = _translate(
            _sse(event="flow_update", action="set_flow", flow=flow),
            _sse(**tail),
            _sse(event="complete", data={"result": "Proposed a flow."}),
        )

        names = _summary(events)
        assert "TOOL_CALL_START:apply_flow_update" not in names
        assert _tool_args(events, "propose_flow") == {
            "value": {"flow": flow, "name": "Chat", "node_count": 2, "edge_count": 1, "tail_updates": [tail]}
        }

    def test_should_apply_an_auto_apply_flow_replacement(self):
        flow_update = {"event": "flow_update", "action": "set_flow", "flow": {"data": {}}, "auto_apply": True}
        events = _translate(_sse(**flow_update))

        assert _tool_args(events, "apply_flow_update") == {"value": flow_update}

    def test_should_propose_a_flow_preview(self):
        flow = {"data": {"nodes": [{"id": "a"}], "edges": []}}
        events = _translate(_sse(event="flow_preview", flow=flow, name="Preview", node_count=1, edge_count=0))

        assert _tool_args(events, "propose_flow") == {
            "value": {"flow": flow, "name": "Preview", "node_count": 1, "edge_count": 0, "tail_updates": []}
        }

    def test_should_batch_field_edits_into_one_review(self):
        edit_1 = {"event": "flow_update", "action": "edit_field", "id": "e1", "field": "temperature"}
        edit_2 = {"event": "flow_update", "action": "edit_field", "id": "e2", "field": "model"}
        events = _translate(
            _sse(**edit_1),
            _sse(**edit_2),
            _sse(event="complete", data={"result": "Two edits.", "continuation_expected": True}),
        )

        assert _summary(events).count("TOOL_CALL_START:propose_field_edits") == 1
        assert _tool_args(events, "propose_field_edits") == {"edits": [edit_1, edit_2], "continuation_expected": True}

    def test_should_propose_a_plan(self):
        events = _translate(_sse(event="flow_update", action="propose_plan", markdown="1. Add a prompt"))

        assert _tool_args(events, "propose_plan") == {"markdown": "1. Add a prompt"}

    def test_should_propose_a_generated_component_instead_of_its_text(self):
        events = _translate(
            _sse(event="progress", step="validated", attempt=1, max_attempts=3),
            _sse(
                event="complete",
                data={
                    "result": "```python\nclass X: ...\n```",
                    "validated": True,
                    "class_name": "X",
                    "component_code": "class X: ...",
                    "validation_attempts": 1,
                },
            ),
        )

        assert "TEXT_MESSAGE_START" not in _summary(events)
        assert _tool_args(events, "propose_component") == {
            "component_code": "class X: ...",
            "class_name": "X",
            "validated": True,
            "validation_error": None,
            "validation_attempts": 1,
        }

    def test_should_show_written_files(self):
        events = _translate(_sse(event="file_written", action="write_file", path="notes.md", size=3, content="abc"))

        assert _summary(events)[0] == "CUSTOM:langflow.file_written"
        assert _tool_args(events, "show_written_file") == {
            "action": "write_file",
            "path": "notes.md",
            "size": 3,
            "content": "abc",
        }

    def test_should_put_the_revert_point_in_the_turn_summary(self):
        events = _translate(_sse(event="complete", data={"result": "ok", "restore_version_id": "v9"}))

        assert _tool_args(events, "show_turn_summary") == {"restore_version_id": "v9"}

    def test_should_end_with_run_error_on_an_assistant_error(self):
        translator = _translator()
        events = translator.translate({"event": "token", "chunk": "par"})
        events += translator.translate({"event": "error", "message": "Rate limited", "detail": {"step": "x"}})

        assert _summary(events)[-3:] == ["TEXT_MESSAGE_END", "CUSTOM:langflow.error", "RUN_ERROR"]
        assert events[-1].message == "Rate limited"
        assert translator.terminated
        assert translator.translate({"event": "token", "chunk": "late"}) == []

    def test_should_finish_cancelled_on_cancel(self):
        translator = _translator()
        events = translator.translate({"event": "cancelled", "message": "Generation cancelled by user"})

        assert events[-1].type == "RUN_FINISHED"
        assert events[-1].result == {"outcome": "cancelled"}
        assert translator.terminated

    def test_should_close_the_previous_step_before_a_new_one(self):
        events = _translate(
            _sse(event="progress", step="generating_component", attempt=1, max_attempts=3),
            _sse(event="progress", step="validating", attempt=1, max_attempts=3),
        )

        steps = [(e.type, e.step_name) for e in events if e.type in ("STEP_STARTED", "STEP_FINISHED")]
        assert steps == [
            ("STEP_STARTED", "generating_component"),
            ("STEP_FINISHED", "generating_component"),
            ("STEP_STARTED", "validating"),
            ("STEP_FINISHED", "validating"),
        ]


def _messages(*items: dict) -> list:
    return RunAgentInput.model_validate(
        {
            "threadId": "t",
            "runId": "r",
            "state": {},
            "messages": list(items),
            "tools": [],
            "context": [],
            "forwardedProps": {},
        }
    ).messages


def _assistant_calls(name: str, args: dict, call_id: str = "c1") -> dict:
    return {
        "id": "a1",
        "role": "assistant",
        "toolCalls": [{"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}],
    }


def _tool_result(answer: dict, call_id: str = "c1") -> dict:
    return {"id": "tr", "role": "tool", "toolCallId": call_id, "content": json.dumps(answer)}


class TestTurnInput:
    def test_should_send_the_last_user_message(self):
        assert turn_input(_messages({"id": "u", "role": "user", "content": "hi"})) == "hi"

    def test_should_continue_an_approved_plan(self):
        messages = _messages(
            {"id": "u", "role": "user", "content": "build"},
            _assistant_calls("propose_plan", {"markdown": "1. x"}),
            _tool_result({"approved": True}),
        )
        assert turn_input(messages) == PLAN_APPROVAL_INPUT

    def test_should_continue_applied_edits_that_were_part_of_a_larger_request(self):
        messages = _messages(
            _assistant_calls("propose_field_edits", {"edits": []}),
            _tool_result({"applied": ["e1"], "continue": True}),
        )
        assert turn_input(messages) == EDIT_CONTINUATION_INPUT

    @pytest.mark.parametrize(
        ("name", "answer"),
        [
            ("apply_flow_update", {"applied": True}),
            ("propose_flow", {"accepted": True}),
            ("propose_plan", {"approved": False, "refine": True}),
            ("propose_field_edits", {"applied": ["e1"], "continue": False}),
            ("propose_component", {"added": True}),
        ],
    )
    def test_should_do_nothing_for_any_other_tool_answer(self, name, answer):
        assert turn_input(_messages(_assistant_calls(name, {}), _tool_result(answer))) is None

    def test_should_quote_a_plan_sent_back_for_refinement(self):
        messages = _messages(
            _assistant_calls("propose_plan", {"markdown": "1. Add a prompt"}),
            _tool_result({"approved": False, "refine": True}),
            {"id": "u2", "role": "user", "content": "use Claude instead"},
        )
        assert turn_input(messages) == build_refinement_input("1. Add a prompt", "use Claude instead")

    def test_should_not_quote_a_dismissed_plan(self):
        messages = _messages(
            _assistant_calls("propose_plan", {"markdown": "1. Add a prompt"}),
            _tool_result({"approved": False, "refine": False}),
            {"id": "u2", "role": "user", "content": "something else"},
        )
        assert turn_input(messages) == "something else"

    def test_should_do_nothing_without_messages_or_text(self):
        assert turn_input([]) is None
        assert turn_input(_messages({"id": "u", "role": "user", "content": "  "})) is None


def test_should_keep_assistant_sessions_out_of_the_playground():
    assert session_id_for("abc") == "agentic_abc"
    assert session_id_for("agentic_abc") == "agentic_abc"


# -- /run end to end --------------------------------------------------------------

ENGINE = "langflow.agentic.services.assistant_service.execute_flow_with_validation_streaming"
ROUTER = "langflow.agentic.api.router"


@pytest.fixture
def agentic_enabled(client):  # noqa: ARG001 — the app must exist first
    from langflow.services.deps import get_settings_service

    settings = get_settings_service().settings
    original = settings.agentic_experience
    settings.agentic_experience = True
    yield
    settings.agentic_experience = original


@pytest.fixture(autouse=True)
def builtin_agents():
    registry.reset_registry()
    yield
    registry.reset_registry()


def _assistant_ctx():
    return SimpleNamespace(
        provider="OpenAI",
        model_name="gpt-5.5",
        api_key_name="OPENAI_API_KEY",
        session_id="agentic_thread-1",
        global_vars={"FLOW_ID": FLOW_ID},
        max_retries=2,
    )


def _body(messages: list[dict], **forwarded) -> dict:
    return {
        "threadId": "thread-1",
        "runId": "run-1",
        "state": {},
        "messages": messages,
        "tools": [],
        "context": [],
        "forwardedProps": {"flow_id": FLOW_ID, **forwarded},
    }


def _events(body: str) -> list[dict]:
    return [json.loads(line[5:].strip()) for line in body.splitlines() if line.startswith("data:")]


@pytest.mark.usefixtures("agentic_enabled")
class TestRunRoute:
    async def test_should_stream_the_assistant_as_ag_ui(self, client: AsyncClient, logged_in_headers):
        captured = {}

        async def engine(flow_filename, **kwargs):
            captured.update(kwargs, flow_filename=flow_filename)
            yield _sse(event="token", chunk="Hi")
            yield _sse(event="flow_update", action="add_component", node={"id": "n1"})
            yield _sse(event="complete", data={"result": "Hi"})

        with (
            patch(ENGINE, new=engine),
            patch(f"{ROUTER}._validate_flow_access", new=AsyncMock(return_value=None)),
            patch(f"{ROUTER}._resolve_assistant_context", new=AsyncMock(return_value=_assistant_ctx())),
        ):
            response = await client.post(
                "api/v1/copilotkit/agent/langflow/run",
                headers=logged_in_headers,
                json=_body(
                    [{"id": "u", "role": "user", "content": "add a chat input"}],
                    history_limit=5,
                    iterations_limit=20,
                ),
            )

        assert response.status_code == status.HTTP_200_OK
        events = _events(response.text)
        types = [e["type"] for e in events]
        assert types[0] == "RUN_STARTED"
        assert types[-1] == "RUN_FINISHED"
        assert "TOOL_CALL_START" in types
        assert next(e for e in events if e["type"] == "TOOL_CALL_START")["toolCallName"] == "apply_flow_update"
        assert captured["flow_filename"] == "LangflowAssistant.json"
        assert captured["input_value"] == "add a chat input"
        assert captured["session_id"] == "agentic_thread-1"
        assert captured["history_limit"] == 5
        assert captured["iterations_limit"] == 20
        assert captured["provider"] == "OpenAI"

    @pytest.mark.parametrize(
        ("forwarded", "expected"),
        [
            ({}, ("OpenAI Compatible", "claude-fable-5-1")),
            ({"provider": "Anthropic", "model_name": "claude-opus-5-5"}, ("Anthropic", "claude-opus-5-5")),
        ],
    )
    async def test_should_use_the_users_default_model_unless_the_panel_picked_one(
        self, client: AsyncClient, logged_in_headers, forwarded, expected
    ):
        from langflow.copilotkit.agents.model_chat import ChatModelChoice

        captured = {}

        async def resolve(request, _user_id, _session):
            captured["request"] = request
            return _assistant_ctx()

        async def engine(**_kwargs):
            yield _sse(event="complete", data={"result": "ok"})

        with (
            patch(ENGINE, new=engine),
            patch(f"{ROUTER}._validate_flow_access", new=AsyncMock(return_value=None)),
            patch(f"{ROUTER}._resolve_assistant_context", new=resolve),
            patch(
                "langflow.copilotkit.agents.model_chat.read_default_language_model",
                new=AsyncMock(return_value=ChatModelChoice("OpenAI Compatible", "claude-fable-5-1")),
            ),
            patch(
                "langflow.agentic.services.provider_service.get_enabled_providers_for_user",
                new=AsyncMock(return_value=(["OpenAI Compatible", "Anthropic"], {})),
            ),
        ):
            await client.post(
                "api/v1/copilotkit/agent/langflow/run",
                headers=logged_in_headers,
                json=_body([{"id": "u", "role": "user", "content": "hi"}], **forwarded),
            )

        assert (captured["request"].provider, captured["request"].model_name) == expected

    async def test_should_ask_for_an_open_flow(self, client: AsyncClient, logged_in_headers):
        body = _body([{"id": "u", "role": "user", "content": "hi"}])
        body["forwardedProps"] = {}

        response = await client.post("api/v1/copilotkit/agent/langflow/run", headers=logged_in_headers, json=body)

        contents = [e["delta"] for e in _events(response.text) if e["type"] == "TEXT_MESSAGE_CONTENT"]
        assert contents == [OPEN_A_FLOW_MESSAGE]

    async def test_should_explain_a_missing_provider_in_the_chat(self, client: AsyncClient, logged_in_headers):
        missing = HTTPException(status_code=400, detail="No model provider is configured.")
        with (
            patch(f"{ROUTER}._validate_flow_access", new=AsyncMock(return_value=None)),
            patch(f"{ROUTER}._resolve_assistant_context", new=AsyncMock(side_effect=missing)),
        ):
            response = await client.post(
                "api/v1/copilotkit/agent/langflow/run",
                headers=logged_in_headers,
                json=_body([{"id": "u", "role": "user", "content": "hi"}]),
            )

        contents = [e["delta"] for e in _events(response.text) if e["type"] == "TEXT_MESSAGE_CONTENT"]
        assert contents == ["No model provider is configured."]

    async def test_should_end_a_follow_up_run_without_calling_the_engine(self, client: AsyncClient, logged_in_headers):
        async def engine(*_args, **_kwargs):
            pytest.fail("the engine must not run for a bare tool answer")
            yield ""

        with patch(ENGINE, new=engine):
            response = await client.post(
                "api/v1/copilotkit/agent/langflow/run",
                headers=logged_in_headers,
                json=_body([_assistant_calls("apply_flow_update", {}), _tool_result({"applied": True})]),
            )

        assert [e["type"] for e in _events(response.text)] == ["RUN_STARTED", "RUN_FINISHED"]

    async def test_should_reject_an_overlong_message_in_the_chat(
        self, client: AsyncClient, logged_in_headers, monkeypatch
    ):
        from langflow.services.deps import get_settings_service

        monkeypatch.setattr(get_settings_service().settings, "assistant_max_message_length", 5)

        response = await client.post(
            "api/v1/copilotkit/agent/langflow/run",
            headers=logged_in_headers,
            json=_body([{"id": "u", "role": "user", "content": "far too long"}]),
        )

        contents = [e["delta"] for e in _events(response.text) if e["type"] == "TEXT_MESSAGE_CONTENT"]
        assert contents == ["Message is too long: 12 characters, limit is 5."]

    async def test_should_pass_cancellation_to_the_engine(self):
        seen = {}

        async def engine(**kwargs):
            seen["is_disconnected"] = kwargs["is_disconnected"]
            yield _sse(event="cancelled", message="Generation cancelled by user")

        agent = LangflowAssistantAgent(engine=engine)
        run_input = RunAgentInput.model_validate(_body([{"id": "u", "role": "user", "content": "hi"}]))
        from contextlib import asynccontextmanager
        from uuid import uuid4

        from langflow.copilotkit.agents.base import AgentRunContext

        @asynccontextmanager
        async def no_session():
            yield None

        ctx = AgentRunContext(user_id=uuid4(), session_scope=no_session)
        with (
            patch(f"{ROUTER}._validate_flow_access", new=AsyncMock(return_value=None)),
            patch(f"{ROUTER}._resolve_assistant_context", new=AsyncMock(return_value=_assistant_ctx())),
            patch(
                "langflow.copilotkit.agents.model_chat.read_default_language_model",
                new=AsyncMock(return_value=None),
            ),
        ):
            events = [e async for e in agent.run(run_input, ctx)]

        assert events[-1].type == "RUN_FINISHED"
        assert events[-1].result == {"outcome": "cancelled"}
        ctx.cancel.set()
        assert await seen["is_disconnected"]() is True
