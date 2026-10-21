"""Wire shapes of the CopilotKit runtime contract (``@copilotkit/runtime`` 1.79.1)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

RUNTIME_VERSION = "1.79.1"
"""The ``@copilotkit/runtime`` release whose ``/info`` shape this server reproduces."""


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class AgentInfo(_CamelModel):
    name: str
    description: str
    class_name: str


class ThreadEndpoints(_CamelModel):
    """Server-side thread routes. None exist: history lives in the browser."""

    list: bool = False
    inspect: bool = False
    mutations: bool = False
    realtime_metadata: bool = False


class RuntimeInfo(_CamelModel):
    """``GET /info``: the agents on offer and which optional runtime features exist."""

    version: str = RUNTIME_VERSION
    agents: dict[str, AgentInfo]
    mode: str = "sse"
    thread_endpoints: ThreadEndpoints = ThreadEndpoints()
    suggestions: bool = False
    audio_file_transcription_enabled: bool = False
    # Spelled out: the camelCase generator would emit ``a2UiEnabled`` / ``openGenerativeUiEnabled``.
    a2ui_enabled: bool = Field(default=False, alias="a2uiEnabled")
    open_generative_ui_enabled: bool = Field(default=False, alias="openGenerativeUIEnabled")
    telemetry_disabled: bool = True


class StopRequest(_CamelModel):
    """Optional body of ``POST /agent/{id}/stop/{threadId}``."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    run_id: str | None = None
