"""AG-UI event encoding and small event builders for CopilotKit agents."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from ag_ui.core import (
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder

if TYPE_CHECKING:
    from collections.abc import Iterator

    from ag_ui.core import BaseEvent

SSE_MEDIA_TYPE = "text/event-stream"
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
KEEP_ALIVE = ": keep-alive\n\n"

_encoder = EventEncoder()


def encode(event: BaseEvent) -> str:
    """One ``data: <event JSON>`` SSE frame, camelCase, with unset fields omitted."""
    return _encoder.encode(event)


def text_message(message_id: str, text: str) -> Iterator[BaseEvent]:
    """A whole assistant text message: start, content, end."""
    yield TextMessageStartEvent(message_id=message_id, role="assistant")
    if text:
        yield TextMessageContentEvent(message_id=message_id, delta=text)
    yield TextMessageEndEvent(message_id=message_id)


def tool_call(
    tool_call_id: str,
    name: str,
    args: str | dict[str, Any],
    *,
    parent_message_id: str | None = None,
) -> Iterator[BaseEvent]:
    """A whole tool call: start, arguments, end. ``args`` is JSON text or a dict to serialize."""
    args_json = args if isinstance(args, str) else json.dumps(args)
    yield ToolCallStartEvent(tool_call_id=tool_call_id, tool_call_name=name, parent_message_id=parent_message_id)
    yield ToolCallArgsEvent(tool_call_id=tool_call_id, delta=args_json)
    yield ToolCallEndEvent(tool_call_id=tool_call_id)
