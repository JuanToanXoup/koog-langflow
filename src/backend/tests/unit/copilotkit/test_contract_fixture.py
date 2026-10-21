"""The wire shapes the backend and the React client must agree on, checked from both sides.

``copilotkit-contract.json`` lives with the frontend tests, which parse it with the
client's own zod schemas (``@ag-ui/core/schemas``). Here the backend parses the same
run body and re-encodes the same events: if either side's shape drifts, one of the two
suites fails.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from ag_ui.core import Event, RunAgentInput
from langflow.copilotkit.encoder import encode
from pydantic import TypeAdapter

REPO_ROOT = Path(__file__).resolve().parents[5]
FIXTURE = REPO_ROOT / "src/frontend/src/components/core/copilotChat/__tests__/fixtures/copilotkit-contract.json"


@pytest.fixture(scope="module")
def contract() -> dict:
    if not FIXTURE.exists():
        pytest.skip("frontend sources are not part of this checkout")
    return json.loads(FIXTURE.read_text())


def test_backend_accepts_the_run_body_the_client_sends(contract):
    run_input = RunAgentInput.model_validate(contract["runAgentInput"])

    assert run_input.thread_id == "agentic_thread-1"
    assert run_input.forwarded_props["flow_id"] == "11111111-1111-4111-8111-111111111111"
    assert run_input.messages[-1].role == "tool"


def test_backend_encodes_events_exactly_as_the_client_expects(contract):
    adapter = TypeAdapter(Event)
    for expected in contract["events"]:
        event = adapter.validate_python(expected)
        frame = encode(event)

        assert frame.startswith("data: ")
        assert json.loads(frame[len("data: ") :]) == expected
