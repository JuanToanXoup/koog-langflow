"""The ``chat`` agent: model choice, message conversion, and token streaming."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from ag_ui.core import RunAgentInput
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, SystemMessage
from langflow.copilotkit.agents.base import AgentRunContext
from langflow.copilotkit.agents.model_chat import (
    NO_PROVIDER_MESSAGE,
    ChatModelChoice,
    ChatModelUnavailableError,
    ModelChatAgent,
    resolve_chat_model,
    to_langchain_messages,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

PROVIDERS = "langflow.agentic.services.provider_service"
READ_DEFAULT = "langflow.copilotkit.agents.model_chat._read_default_language_model"


class FakeStreamingModel:
    """Streams fixed chunks and records what it was asked."""

    def __init__(self, chunks: list[object]):
        self.chunks = chunks
        self.received: list | None = None

    async def astream(self, messages) -> AsyncIterator[AIMessageChunk]:
        self.received = messages
        for chunk in self.chunks:
            yield chunk if isinstance(chunk, AIMessageChunk) else AIMessageChunk(content=chunk)


@asynccontextmanager
async def _no_session():
    yield None


def _ctx() -> AgentRunContext:
    return AgentRunContext(user_id=uuid4(), session_scope=_no_session)


def _input(messages: list[dict], forwarded_props: dict | None = None, context: list | None = None) -> RunAgentInput:
    return RunAgentInput.model_validate(
        {
            "threadId": "t1",
            "runId": "r1",
            "state": {},
            "messages": messages,
            "tools": [],
            "context": context or [],
            "forwardedProps": forwarded_props or {},
        }
    )


async def _events(agent: ModelChatAgent, run_input: RunAgentInput) -> list:
    return [event async for event in agent.run(run_input, _ctx())]


def _resolver(choice):
    async def resolve(_user_id, _props, _session):
        if isinstance(choice, Exception):
            raise choice
        return choice

    return resolve


CHOICE = ChatModelChoice(provider="OpenAI", model_name="gpt-5.5")


class TestStreaming:
    async def test_should_stream_each_chunk_as_message_content(self):
        model = FakeStreamingModel(["Hel", "lo", " there"])
        agent = ModelChatAgent(model_resolver=_resolver(CHOICE), model_factory=lambda *_: model)

        events = await _events(agent, _input([{"id": "u1", "role": "user", "content": "hi"}]))

        assert [e.type for e in events] == [
            "TEXT_MESSAGE_START",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_END",
        ]
        assert [e.delta for e in events[1:4]] == ["Hel", "lo", " there"]
        assert len({e.message_id for e in events}) == 1
        assert model.received == [HumanMessage(content="hi")]

    async def test_should_skip_empty_chunks_and_read_content_blocks(self):
        chunks = ["", AIMessageChunk(content=[{"type": "text", "text": "block"}, {"type": "tool_use", "id": "x"}])]
        agent = ModelChatAgent(model_resolver=_resolver(CHOICE), model_factory=lambda *_: FakeStreamingModel(chunks))

        events = await _events(agent, _input([{"id": "u1", "role": "user", "content": "hi"}]))

        assert [e.type for e in events] == ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]
        assert events[1].delta == "block"

    async def test_should_build_the_model_the_resolver_chose(self):
        built = []

        def factory(choice, user_id):
            built.append((choice, user_id))
            return FakeStreamingModel(["ok"])

        agent = ModelChatAgent(model_resolver=_resolver(CHOICE), model_factory=factory)
        await _events(agent, _input([{"id": "u1", "role": "user", "content": "hi"}]))

        assert built[0][0] == CHOICE

    async def test_should_stop_streaming_once_cancelled(self):
        ctx = _ctx()

        class CancelsAfterFirst(FakeStreamingModel):
            async def astream(self, messages):
                del messages
                for chunk in ("one", "two", "three"):
                    yield AIMessageChunk(content=chunk)
                    ctx.cancel.set()

        agent = ModelChatAgent(model_resolver=_resolver(CHOICE), model_factory=lambda *_: CancelsAfterFirst([]))
        events = [e async for e in agent.run(_input([{"id": "u1", "role": "user", "content": "hi"}]), ctx)]

        assert [e.type for e in events] == ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]


class TestNoModel:
    async def test_should_tell_the_user_to_configure_a_provider(self):
        def factory(*_):
            pytest.fail("no model should be built")

        agent = ModelChatAgent(model_resolver=_resolver(None), model_factory=factory)

        events = await _events(agent, _input([{"id": "u1", "role": "user", "content": "hi"}]))

        assert [e.type for e in events] == ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]
        assert events[1].delta == NO_PROVIDER_MESSAGE

    async def test_should_show_why_the_requested_model_cannot_be_used(self):
        agent = ModelChatAgent(model_resolver=_resolver(ChatModelUnavailableError("Groq is not configured")))

        events = await _events(agent, _input([{"id": "u1", "role": "user", "content": "hi"}]))

        assert events[1].delta == "Groq is not configured"


class TestMessageConversion:
    def test_should_keep_prose_and_drop_tool_traffic(self):
        run_input = _input(
            [
                {"id": "s", "role": "system", "content": "be brief"},
                {"id": "u1", "role": "user", "content": "build a flow"},
                {
                    "id": "a1",
                    "role": "assistant",
                    "content": "Proposing a flow.",
                    "toolCalls": [
                        {"id": "t1", "type": "function", "function": {"name": "propose_flow", "arguments": "{}"}}
                    ],
                },
                {"id": "tr", "role": "tool", "content": "applied", "toolCallId": "t1"},
                {"id": "a2", "role": "assistant", "toolCalls": []},
                {"id": "u2", "role": "user", "content": [{"type": "text", "text": "thanks"}]},
            ]
        )

        assert to_langchain_messages(run_input.messages) == [
            SystemMessage(content="be brief"),
            HumanMessage(content="build a flow"),
            AIMessage(content="Proposing a flow."),
            HumanMessage(content="thanks"),
        ]

    def test_should_lead_with_app_context(self):
        run_input = _input(
            [{"id": "u1", "role": "user", "content": "hi"}],
            context=[{"description": "Open flow", "value": "Basic Prompting"}],
        )

        messages = to_langchain_messages(run_input.messages, run_input.context)

        assert messages[0] == SystemMessage(content="Context from the app:\n- Open flow: Basic Prompting")


class TestResolveChatModel:
    async def test_should_return_none_without_a_configured_provider(self):
        with patch(f"{PROVIDERS}.get_enabled_providers_for_user", new=AsyncMock(return_value=([], {}))):
            assert await resolve_chat_model(uuid4(), {}, None) is None

    async def test_should_honor_the_panels_model_override(self):
        with patch(f"{PROVIDERS}.get_enabled_providers_for_user", new=AsyncMock(return_value=(["OpenAI"], {}))):
            choice = await resolve_chat_model(uuid4(), {"provider": "OpenAI", "model_name": "gpt-5.4"}, None)

        assert choice == ChatModelChoice("OpenAI", "gpt-5.4")

    async def test_should_refuse_an_override_for_an_unconfigured_provider(self):
        with (
            patch(f"{PROVIDERS}.get_enabled_providers_for_user", new=AsyncMock(return_value=(["OpenAI"], {}))),
            pytest.raises(ChatModelUnavailableError, match="Groq"),
        ):
            await resolve_chat_model(uuid4(), {"provider": "Groq", "model_name": "llama"}, None)

    async def test_should_prefer_the_users_default_language_model(self):
        default = SimpleNamespace(value=json.dumps({"provider": "Groq", "model_name": "llama", "model_type": "llm"}))
        variables = SimpleNamespace(get_variable_object=AsyncMock(return_value=default))
        with (
            patch(f"{PROVIDERS}.get_enabled_providers_for_user", new=AsyncMock(return_value=(["OpenAI", "Groq"], {}))),
            patch("langflow.services.deps.get_variable_service", return_value=variables),
            patch("langflow.services.variable.service.DatabaseVariableService", SimpleNamespace),
        ):
            choice = await resolve_chat_model(uuid4(), {}, None)

        assert choice == ChatModelChoice("Groq", "llama")

    async def test_should_fall_back_to_the_preferred_provider_default(self):
        with (
            patch(f"{PROVIDERS}.get_enabled_providers_for_user", new=AsyncMock(return_value=(["Groq", "OpenAI"], {}))),
            patch(
                "langflow.copilotkit.agents.model_chat._read_default_language_model", new=AsyncMock(return_value=None)
            ),
            patch(f"{PROVIDERS}.get_default_model", return_value="gpt-5.4"),
        ):
            choice = await resolve_chat_model(uuid4(), {}, None)

        assert choice == ChatModelChoice("OpenAI", "gpt-5.4")
