import type { Page, Route } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { openStarterProject } from "../../utils/flow/open-starter-project";
import { mockAssistant } from "../../utils/mock-assistant";

const AGENTS = {
  version: "1.79.1",
  agents: {
    langflow: {
      name: "Langflow Assistant",
      description: "Builds and edits the open flow.",
      className: "LangflowAssistantAgent",
    },
    chat: {
      name: "Chat",
      description: "Chat with your default model.",
      className: "ModelChatAgent",
    },
  },
  mode: "sse",
  threadEndpoints: {
    list: false,
    inspect: false,
    mutations: false,
    realtimeMetadata: false,
  },
  suggestions: false,
  audioFileTranscriptionEnabled: false,
  a2uiEnabled: false,
  openGenerativeUIEnabled: false,
  telemetryDisabled: true,
};

type AgUiEvent = Record<string, unknown> & { type: string };

/** Answer one CopilotKit run with these AG-UI events, framed as SSE. */
async function fulfillRun(route: Route, events: AgUiEvent[]): Promise<void> {
  const input = route.request().postDataJSON() as {
    threadId: string;
    runId: string;
  };
  const framed = [
    { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId },
    ...events,
    { type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId },
  ];
  await route.fulfill({
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
    body: framed.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  });
}

function textMessage(id: string, text: string): AgUiEvent[] {
  return [
    { type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: text },
    { type: "TEXT_MESSAGE_END", messageId: id },
  ];
}

function toolCall(
  id: string,
  name: string,
  args: unknown,
  parentMessageId: string,
): AgUiEvent[] {
  return [
    {
      type: "TOOL_CALL_START",
      toolCallId: id,
      toolCallName: name,
      parentMessageId,
    },
    { type: "TOOL_CALL_ARGS", toolCallId: id, delta: JSON.stringify(args) },
    { type: "TOOL_CALL_END", toolCallId: id },
  ];
}

async function mockRuntime(page: Page) {
  await page.route("**/api/v1/copilotkit/info", (route) =>
    route.fulfill({ json: AGENTS }),
  );
  await page.route("**/api/v1/copilotkit/agent/*/connect", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: "",
    }),
  );
}

async function openChat(page: Page) {
  await page.getByTestId("assistant-button").click();
  const panel = page.getByTestId("assistant-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("copilot-agent-picker")).toHaveText(
    /Langflow Assistant/,
  );
  return panel;
}

async function pickAgent(page: Page, agentId: string) {
  await page.getByTestId("copilot-agent-picker").click();
  await page.getByTestId(`copilot-agent-option-${agentId}`).click();
}

async function send(page: Page, text: string) {
  const input = page.getByTestId("copilot-chat-textarea");
  await input.fill(text);
  await input.press("Enter");
}

test.describe("Assistant chat (CopilotKit)", { tag: ["@release"] }, () => {
  test.beforeEach(async ({ page }) => {
    await mockAssistant(page);
    await mockRuntime(page);
  });

  test("opens from the rail button and offers both agents", async ({
    page,
  }) => {
    await openStarterProject(page, "Basic Prompting");
    await expect(page.getByTestId("assistant-panel")).not.toBeVisible();

    await openChat(page);
    await page.getByTestId("copilot-agent-picker").click();

    await expect(
      page.getByTestId("copilot-agent-option-langflow"),
    ).toContainText("Builds and edits the open flow.");
    await expect(page.getByTestId("copilot-agent-option-chat")).toContainText(
      "Chat with your default model.",
    );
    // Escape would close the whole panel (it is the panel's shortcut), so close
    // the menu by picking an agent.
    await page.getByTestId("copilot-agent-option-chat").click();
    await expect(page.getByTestId("copilot-agent-picker")).toHaveText(/Chat/);

    await page.getByTestId("assistant-close").click();
    await expect(page.getByTestId("assistant-panel")).not.toBeVisible();
  });

  test("sends a message to the chat agent and shows its reply", async ({
    page,
  }) => {
    let runBody: Record<string, unknown> | undefined;
    await page.route("**/api/v1/copilotkit/agent/chat/run", async (route) => {
      runBody = route.request().postDataJSON();
      await fulfillRun(route, textMessage("m1", "Hello from the chat agent"));
    });
    await openStarterProject(page, "Basic Prompting");
    await openChat(page);
    await pickAgent(page, "chat");

    await send(page, "hello");

    await expect(page.getByText("Hello from the chat agent")).toBeVisible();
    const forwarded = runBody?.forwardedProps as Record<string, unknown>;
    expect(forwarded.flow_id).toBeTruthy();
    expect(forwarded.provider).toBe("OpenAI");
    expect(forwarded.model_name).toBe("gpt-4o-mini");
  });

  test("runs panel commands locally, without a run", async ({ page }) => {
    let runs = 0;
    await page.route("**/api/v1/copilotkit/agent/*/run", async (route) => {
      runs += 1;
      await fulfillRun(route, []);
    });
    await openStarterProject(page, "Basic Prompting");
    await openChat(page);

    const input = page.getByTestId("copilot-chat-textarea");
    await input.pressSequentially("/hist");
    await expect(
      page.getByTestId("assistant-slash-command-option-history"),
    ).toBeVisible();
    await input.press("Enter");
    await expect(input).toHaveValue("/history ");
    await input.pressSequentially("3");
    await input.press("Enter");

    await expect(
      page.getByText("History limit set to 3 message(s) for this session."),
    ).toBeVisible();
    expect(runs).toBe(0);
  });

  test("replaces the canvas with a flow the assistant proposes", async ({
    page,
  }) => {
    await openStarterProject(page, "Basic Prompting");
    const nodesBefore = await page.locator(".react-flow__node").count();
    expect(nodesBefore).toBeGreaterThan(2);

    // Propose a two-component flow made from the canvas's own first two nodes,
    // so the proposal is valid Langflow data.
    const flowId = page.url().split("/flow/")[1].split("/")[0];
    const proposal = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/flows/${id}`, { headers: {} });
      const flow = await response.json();
      const nodes = flow.data.nodes.slice(0, 2);
      return { name: "Two nodes", data: { nodes, edges: [] } };
    }, flowId);

    await page.route(
      "**/api/v1/copilotkit/agent/langflow/run",
      async (route) => {
        await fulfillRun(route, [
          ...textMessage("m1", "Here is a smaller flow."),
          ...toolCall(
            "t1",
            "propose_flow",
            {
              value: {
                flow: proposal,
                name: "Two nodes",
                node_count: 2,
                edge_count: 0,
                tail_updates: [],
              },
            },
            "m1",
          ),
        ]);
      },
    );
    await openChat(page);

    await send(page, "Make this flow smaller");

    const card = page.getByTestId("copilot-flow-proposal");
    await expect(card).toBeVisible();
    await expect(
      card.getByTestId("assistant-flow-dismiss-button"),
    ).toBeVisible();
    await card.getByTestId("assistant-flow-replace-button").click();

    // Applying a proposal closes the panel so the new canvas is in view.
    await expect(page.getByTestId("assistant-panel")).not.toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
  });
});
