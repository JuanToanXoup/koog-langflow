# Spike T0.1: CopilotKit runtime contract against a FastAPI echo server

Result: **passes.** `@copilotkit/react-core@1.79.1` (v2 entry point) talks to a hand-written FastAPI runtime with no Node runtime in between.
Run on 2026-10-20 in headless Chromium. The Vite page and the FastAPI server were linked by a Vite proxy, which is same-origin like Langflow.
Server events came from `ag_ui.encoder.EventEncoder` (`ag-ui-protocol==0.1.18`, from Langflow's venv). Throwaway code is in the session scratchpad, not the repo.

## Contract as observed

| Route | Observed client behaviour | What the server returned |
|---|---|---|
| `GET {base}/info` | Called 1–3× per page load. The §1 JSON shape was accepted as-is, with no extra fields needed. | 200 JSON |
| `POST {base}/agent/{id}/run` | Body fields: `threadId, runId, protocolVersion:"1.0", state, messages, tools, context, forwardedProps`. `RunAgentInput.model_validate` accepts it; the extra `protocolVersion` is ignored. `tools` lists every registered frontend tool and HITL tool, on every run. | `text/event-stream`, `Cache-Control: no-cache` |
| `POST {base}/agent/{id}/connect` | Called **only when `threadId` is passed** to `<CopilotChat>`, twice on mount. Body is `RunAgentInput` with `messages: []`. | **An empty SSE stream that ends at once is accepted** (no error, nothing to resume). A 204 was not tried, so the plan uses the empty SSE. |
| `POST {base}/agent/{id}/stop/{threadId}` | While a run is going, the send button acts as Stop. Clicking it sends this call. | 204 |

## Findings that change the plan

1. **Tool calls are not fire-and-forget (affects T1.5 and T2.6).** `FrontendTool.followUp` defaults to on.
   - After `useFrontendTool`'s handler returns, the client **automatically POSTs a second `/run`**. Its `messages` end with `assistant(toolCalls:[apply_flow_update])` and then `tool("applied")`.
   - `useHumanInTheLoop` behaves the same way. After `respond({accepted:true})`, a second `/run` arrives ending with `tool('{"accepted":true}')`.
   - With `followUp: false`, no second run happens. The tool result rides along with the next user turn.
   - Fix: set `followUp: false` on `apply_flow_update` and `propose_flow`. Also make the `langflow` agent end at once, with just `RUN_STARTED` and `RUN_FINISHED`, when the last message is `role:"tool"`. Otherwise it would re-run the Langflow Assistant on the text "applied".
2. **Provider `properties` arrive as `RunAgentInput.forwardedProps`.** `properties={{flow_id}}` produced `forwardedProps: {"flow_id": "flow-123"}`. This answers T2.5: use provider `properties`.
3. **Stop only works if the server ends the stream.** After `/stop` returned 204, the client kept rendering chunks until the server closed the stream (chunk8 → chunk12 over 5 s). T1.3's cancel event is therefore required, not optional. The stream must close promptly when it is set.
4. **History is not kept across reloads.** With a fixed `threadId`, reloading the page shows an empty chat, because `/connect` returns nothing to replay.
   - Within one page session the history stays.
   - §0 "Thread history kept client-side by CopilotKit" holds only until a reload. Retiring `history-storage.ts` therefore loses what today's panel keeps: persisted history and the session dropdown.
   - Fix: either make `/connect` replay stored AG-UI events or messages for the thread from a server-side store, or persist messages client-side and seed them back on load.
5. **`showDevConsole` is deprecated and does nothing (affects T2.3).**
   - In development builds on localhost, the CopilotKit Inspector is on by default. It adds a floating button and an upsell popover ("AG-UI 1.0 is here…", "Rich Threads", "Automatic Learning").
   - It also fetches `cdn.copilotkit.ai/notifications/v1.json`, `cdn.copilotkit.ai/inspector-hud/v1.json` and Google Fonts.
   - `enableInspector={false}` removes the button and **all** external requests. The types say the Inspector is always off on remote hosts and in production builds.

## Other observations

- Dark mode: `.dark` on `#body` switches the chat to its dark theme. In light mode, `body` stays at browser defaults (font, 8px margin), so CopilotKit's CSS does not style the page body.
- Dependency weight: a clean install of `@copilotkit/react-core@1.79.1`, `react`, `react-dom`, `vite` and `zod` added **1003 packages**, and `node_modules/@copilotkit` alone is 25 MB.
  Runtime dependencies include `lit`, `katex`, `streamdown`, `react-markdown@8`, `@jetbrains/websandbox`, `@copilotkit/{a2ui-renderer,mcp-apps-renderer,web-inspector,runtime-client-gql}` and `@scarf/scarf`.
  Scarf sends install-time analytics; opt out with `SCARF_ANALYTICS=false` or `"scarfSettings": {"enabled": false}` in `package.json`. Measure the bundle size in T2.1.
- `zod`: Langflow has `^3.23.8`, and react-core's peer dependency needs `>=3.25`, so T2.1 must bump it. `@ag-ui/client` and `@ag-ui/core` are pinned exactly at `1.0.2` by react-core; Langflow pins `@ag-ui/client@1.0.0`, as §1 says.
- Dev-only console warning: "Lit is in dev mode".
- The client also knows a `POST {base}/agent/{id}/suggest` route. It is not called while `/info` reports `suggestions: false`.
