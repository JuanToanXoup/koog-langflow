"""CopilotKit runtime for the assistant chat panel.

FastAPI implements the CopilotKit runtime HTTP contract (multi-route mode) at
``/api/v1/copilotkit`` so the React ``CopilotKitProvider`` talks to Langflow
directly, with no Node runtime in between. Each chat agent is an AG-UI event
producer registered in :mod:`langflow.copilotkit.registry`.
"""
