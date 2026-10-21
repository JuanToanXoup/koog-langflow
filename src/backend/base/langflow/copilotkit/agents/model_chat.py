"""The ``chat`` agent: plain chat with the user's model.

No tools and no canvas access: the conversation goes straight to the model the
user picked (``forwardedProps.provider`` / ``model_name`` from the panel's model
picker), else their default language model from Settings, else the assistant's
preferred provider among the ones they configured.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from ag_ui.core import TextMessageContentEvent, TextMessageEndEvent, TextMessageStartEvent
from lfx.services.model_provider_policy import ModelProviderPolicyPurpose

from langflow.copilotkit.agents.base import AgentRunContext, CopilotAgent
from langflow.copilotkit.encoder import text_message

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
    from uuid import UUID

    from ag_ui.core import BaseEvent, Context, Message, RunAgentInput
    from langchain_core.language_models import BaseChatModel
    from langchain_core.messages import BaseMessage
    from sqlalchemy.ext.asyncio import AsyncSession

NO_PROVIDER_MESSAGE = (
    "No model provider is configured yet. Connect one in **Settings → Model Providers**, then send your message again."
)


class ChatModelUnavailableError(Exception):
    """The requested model cannot be used; the message is shown to the user as is."""


@dataclass(frozen=True)
class ChatModelChoice:
    provider: str
    model_name: str


async def resolve_chat_model(
    user_id: UUID, forwarded_props: dict[str, Any], session: AsyncSession
) -> ChatModelChoice | None:
    """Pick the model for this run, or None when the user has no provider configured.

    Raises:
        ChatModelUnavailableError: the panel asked for a provider the user cannot use.
    """
    from langflow.agentic.services.provider_service import (
        PREFERRED_PROVIDERS,
        get_default_model,
        get_enabled_providers_for_user,
    )

    enabled, _ = await get_enabled_providers_for_user(user_id, session, purpose=ModelProviderPolicyPurpose.USE)
    if not enabled:
        return None

    provider = forwarded_props.get("provider")
    model_name = forwarded_props.get("model_name")
    if isinstance(provider, str) and provider:
        if provider not in enabled:
            msg = f"The provider **{provider}** is not configured. Pick another model, or connect it in Settings."
            raise ChatModelUnavailableError(msg)
        chosen = model_name if isinstance(model_name, str) and model_name else get_default_model(provider, user_id)
        return _choice(provider, chosen)

    default = await _read_default_language_model(user_id, session)
    if default is not None and default.provider in enabled:
        return default

    provider = next((p for p in PREFERRED_PROVIDERS if p in enabled), enabled[0])
    return _choice(provider, get_default_model(provider, user_id))


def _choice(provider: str, model_name: str | None) -> ChatModelChoice:
    if not model_name:
        msg = f"**{provider}** has no model available. Enable one in Settings → Model Providers."
        raise ChatModelUnavailableError(msg)
    return ChatModelChoice(provider=provider, model_name=model_name)


async def _read_default_language_model(user_id: UUID, session: AsyncSession) -> ChatModelChoice | None:
    """The user's default language model from Settings, as ``GET /models/default_model`` reads it."""
    from langflow.api.v1.models import DEFAULT_LANGUAGE_MODEL_VAR
    from langflow.services.deps import get_variable_service
    from langflow.services.variable.service import DatabaseVariableService

    variable_service = get_variable_service()
    if not isinstance(variable_service, DatabaseVariableService):
        return None
    try:
        variable = await variable_service.get_variable_object(
            user_id=user_id, name=DEFAULT_LANGUAGE_MODEL_VAR, session=session
        )
        parsed = json.loads(variable.value or "")
    except (ValueError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    provider, model_name = parsed.get("provider"), parsed.get("model_name")
    if not (isinstance(provider, str) and provider and isinstance(model_name, str) and model_name):
        return None
    return ChatModelChoice(provider=provider, model_name=model_name)


def build_chat_model(choice: ChatModelChoice, user_id: UUID) -> BaseChatModel:
    """The LangChain chat model, built the way the Language Model component builds one."""
    from lfx.base.models.unified_models import get_llm

    return get_llm(
        model=[{"name": choice.model_name, "provider": choice.provider, "metadata": {}}],
        user_id=user_id,
        stream=True,
    )


def to_langchain_messages(messages: Sequence[Message], context: Sequence[Context] = ()) -> list[BaseMessage]:
    """The conversation as LangChain messages.

    Tool calls and tool results are dropped: this agent has no tools, and a thread
    can carry another agent's (the panel lets the user switch agents mid-thread).
    A dangling tool result would be rejected by most providers.
    """
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    out: list[BaseMessage] = []
    if context:
        lines = "\n".join(f"- {item.description}: {item.value}" for item in context)
        out.append(SystemMessage(content=f"Context from the app:\n{lines}"))
    for message in messages:
        text = _message_text(getattr(message, "content", None))
        if message.role == "user" and text:
            out.append(HumanMessage(content=text))
        elif message.role == "assistant" and text:
            out.append(AIMessage(content=text))
        elif message.role in {"system", "developer"} and text:
            out.append(SystemMessage(content=text))
    return out


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [_part_text(part) for part in content]
        return "\n".join(p for p in parts if p)
    return ""


def _part_text(part: Any) -> str | None:
    text = part.get("text") if isinstance(part, dict) else getattr(part, "text", None)
    return text if isinstance(text, str) else None


def _chunk_text(chunk: Any) -> str:
    content = getattr(chunk, "content", chunk)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        # Anthropic-style content blocks: only the text blocks are prose.
        return "".join(
            block.get("text", "") for block in content if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


class ModelChatAgent(CopilotAgent):
    """Talks to the user's default model directly, with no tools."""

    id = "chat"
    name = "Chat"
    description = "Chat with your default model. No tools, no canvas access."

    def __init__(
        self,
        *,
        model_resolver: Callable[[UUID, dict[str, Any], AsyncSession], Awaitable[ChatModelChoice | None]] | None = None,
        model_factory: Callable[[ChatModelChoice, UUID], BaseChatModel] | None = None,
    ) -> None:
        self._resolve = model_resolver or resolve_chat_model
        self._build = model_factory or build_chat_model

    async def run(self, run_input: RunAgentInput, ctx: AgentRunContext) -> AsyncIterator[BaseEvent]:
        props = run_input.forwarded_props if isinstance(run_input.forwarded_props, dict) else {}
        try:
            async with ctx.session_scope() as session:
                choice = await self._resolve(ctx.user_id, props, session)
        except ChatModelUnavailableError as exc:
            for event in text_message(str(uuid4()), str(exc)):
                yield event
            return
        if choice is None:
            for event in text_message(str(uuid4()), NO_PROVIDER_MESSAGE):
                yield event
            return

        messages = to_langchain_messages(run_input.messages, run_input.context)
        if not messages:
            return
        model = self._build(choice, ctx.user_id)

        message_id = str(uuid4())
        started = False
        async for chunk in model.astream(messages):
            if ctx.cancel.is_set():
                break
            text = _chunk_text(chunk)
            if not text:
                continue
            if not started:
                yield TextMessageStartEvent(message_id=message_id, role="assistant")
                started = True
            yield TextMessageContentEvent(message_id=message_id, delta=text)
        if started:
            yield TextMessageEndEvent(message_id=message_id)
