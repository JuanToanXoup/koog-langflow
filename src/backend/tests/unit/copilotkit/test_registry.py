"""The CopilotKit agent registry: built-ins, explicit registration, and entry-point plugins."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest
from langflow.copilotkit import registry
from langflow.copilotkit.agents.base import AgentRunContext, CopilotAgent

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from ag_ui.core import BaseEvent, RunAgentInput


class FakeAgent(CopilotAgent):
    id = "fake"
    name = "Fake"
    description = "A test agent."

    async def run(self, run_input: RunAgentInput, ctx: AgentRunContext) -> AsyncIterator[BaseEvent]:
        del run_input, ctx
        return
        yield


class _EntryPoint:
    def __init__(self, name: str, target: object):
        self.name = name
        self._target = target

    def load(self) -> object:
        if isinstance(self._target, Exception):
            raise self._target
        return self._target


@pytest.fixture(autouse=True)
def _fresh_registry():
    registry.reset_registry()
    yield
    registry.reset_registry()


def _with_entry_points(*eps: _EntryPoint):
    return patch("importlib.metadata.entry_points", return_value=list(eps))


def test_should_list_the_built_in_agents():
    with _with_entry_points():
        agents = registry.get_agents()

    assert list(agents) == ["langflow", "chat"]
    assert agents["langflow"].executes_component_code is True
    assert agents["chat"].executes_component_code is False


def test_should_list_a_registered_agent():
    with _with_entry_points():
        registry.register(FakeAgent())
        agents = registry.get_agents()

    assert "fake" in agents
    assert agents["fake"].name == "Fake"
    assert registry.get_agent("fake") is agents["fake"]


def test_should_refuse_a_duplicate_id_unless_replacing():
    with _with_entry_points():
        registry.register(FakeAgent())
        with pytest.raises(ValueError, match="already registered"):
            registry.register(FakeAgent())
        replacement = FakeAgent()
        registry.register(replacement, replace=True)

        assert registry.get_agent("fake") is replacement


@pytest.mark.parametrize("bad_id", ["", "Has Caps", "a/b", "../x", "-leading"])
def test_should_refuse_an_id_that_is_not_a_url_slug(bad_id):
    agent = FakeAgent()
    agent.id = bad_id  # type: ignore[misc]

    with pytest.raises(ValueError, match="Invalid agent id"):
        registry.register(agent)


def test_should_refuse_something_that_is_not_an_agent():
    with pytest.raises(TypeError):
        registry.register(object())  # type: ignore[arg-type]


def test_should_discover_an_agent_class_from_an_entry_point():
    with _with_entry_points(_EntryPoint("fake", FakeAgent)):
        agents = registry.get_agents()

    assert isinstance(agents["fake"], FakeAgent)


def test_should_discover_an_agent_instance_from_an_entry_point():
    instance = FakeAgent()
    with _with_entry_points(_EntryPoint("fake", instance)):
        assert registry.get_agent("fake") is instance


def test_should_skip_plugins_that_fail_or_are_not_agents():
    with _with_entry_points(
        _EntryPoint("broken", ImportError("boom")),
        _EntryPoint("not-an-agent", object),
        _EntryPoint("fake", FakeAgent),
    ):
        agents = registry.get_agents()

    assert set(agents) == {"langflow", "chat", "fake"}


def test_should_not_let_a_plugin_replace_a_built_in_agent():
    class Impostor(FakeAgent):
        id = "langflow"

    with _with_entry_points(_EntryPoint("impostor", Impostor)):
        agent = registry.get_agent("langflow")

    assert not isinstance(agent, Impostor)


def test_should_load_entry_points_once():
    with patch("importlib.metadata.entry_points", return_value=[]) as discovered:
        registry.get_agents()
        registry.get_agents()
        registry.get_agent("chat")

    assert discovered.call_count == 1
