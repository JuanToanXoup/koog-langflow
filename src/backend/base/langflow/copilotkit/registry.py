"""Registry of CopilotKit chat agents.

Built-in agents load on first use. Installed packages can add more through the
``langflow.copilotkit_agents`` entry-point group, the same discovery mechanism
``lfx.services`` uses for service plugins. An entry point may name a
``CopilotAgent`` subclass (instantiated with no arguments) or an instance::

    [project.entry-points."langflow.copilotkit_agents"]
    my_agent = "my_package.agents:MyAgent"

A plugin cannot replace a built-in agent, and a plugin that fails to import or is
not a ``CopilotAgent`` is logged and skipped so it cannot stop Langflow starting.
"""

from __future__ import annotations

import threading

from lfx.log.logger import logger

from langflow.copilotkit.agents.base import AGENT_ID_PATTERN, CopilotAgent

ENTRY_POINT_GROUP = "langflow.copilotkit_agents"

_agents: dict[str, CopilotAgent] = {}
_builtin_ids: set[str] = set()
_loaded = False
_lock = threading.RLock()


def register(agent: CopilotAgent, *, replace: bool = False) -> None:
    """Add an agent to the registry.

    Raises:
        TypeError: ``agent`` is not a ``CopilotAgent`` instance.
        ValueError: the id is not a URL-safe slug, or is taken and ``replace`` is false.
    """
    if not isinstance(agent, CopilotAgent):
        msg = f"Expected a CopilotAgent instance, got {type(agent).__name__}"
        raise TypeError(msg)
    agent_id = getattr(agent, "id", None)
    if not isinstance(agent_id, str) or not AGENT_ID_PATTERN.match(agent_id):
        msg = f"Invalid agent id {agent_id!r}: use a lowercase slug (letters, digits, '-', '_')"
        raise ValueError(msg)
    with _lock:
        if agent_id in _agents and not replace:
            msg = f"An agent with id {agent_id!r} is already registered"
            raise ValueError(msg)
        _agents[agent_id] = agent


def get_agents() -> dict[str, CopilotAgent]:
    """All registered agents, keyed by id, built-ins first."""
    _ensure_loaded()
    with _lock:
        return dict(_agents)


def get_agent(agent_id: str) -> CopilotAgent | None:
    _ensure_loaded()
    with _lock:
        return _agents.get(agent_id)


def reset_registry() -> None:
    """Forget every agent so the next lookup loads again. For tests."""
    global _loaded  # noqa: PLW0603 - module-level one-shot latch
    with _lock:
        _agents.clear()
        _builtin_ids.clear()
        _loaded = False


def _ensure_loaded() -> None:
    global _loaded  # noqa: PLW0603 - module-level one-shot latch
    with _lock:
        if _loaded:
            return
        # Set first: a plugin that looks the registry up while it loads must see
        # what is there so far, not start the load again.
        _loaded = True
        _load_builtins()
        _load_entry_points()


def _load_builtins() -> None:
    from langflow.copilotkit.agents.langflow_assistant import LangflowAssistantAgent
    from langflow.copilotkit.agents.model_chat import ModelChatAgent

    for agent in (LangflowAssistantAgent(), ModelChatAgent()):
        register(agent)
        _builtin_ids.add(agent.id)


def _load_entry_points() -> None:
    from importlib.metadata import entry_points

    try:
        discovered = entry_points(group=ENTRY_POINT_GROUP)
    except Exception:  # noqa: BLE001 - a broken environment must not block startup
        logger.warning("Could not enumerate %s entry points", ENTRY_POINT_GROUP, exc_info=True)
        return

    for entry_point in discovered:
        try:
            loaded = entry_point.load()
            agent = loaded() if isinstance(loaded, type) else loaded
        except Exception:  # noqa: BLE001 - one bad plugin must not hide the others
            logger.warning("Could not load CopilotKit agent plugin %r", entry_point.name, exc_info=True)
            continue
        agent_id = getattr(agent, "id", None)
        if agent_id in _builtin_ids:
            logger.warning(
                "Refusing CopilotKit agent plugin %r: id %r belongs to a built-in agent", entry_point.name, agent_id
            )
            continue
        try:
            register(agent)
        except (TypeError, ValueError):
            logger.warning("Refusing CopilotKit agent plugin %r", entry_point.name, exc_info=True)
            continue
        logger.info("Registered CopilotKit agent %r from entry point %r", agent_id, entry_point.name)
