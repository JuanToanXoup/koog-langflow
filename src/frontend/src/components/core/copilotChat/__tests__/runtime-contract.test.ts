/**
 * The wire shapes the Langflow backend and the CopilotKit client must agree on.
 *
 * The fixture is also read by the backend suite
 * (src/backend/tests/unit/copilotkit/test_contract_fixture.py), which parses the
 * same run body and re-encodes the same events. Here they go through the client's
 * own zod schemas, so drift on either side fails one of the two suites.
 */
import { EventSchemas, RunAgentInputSchema } from "@ag-ui/core/schemas";
import contract from "./fixtures/copilotkit-contract.json";

describe("CopilotKit runtime contract", () => {
  it("is a run body the client produces", () => {
    const parsed = RunAgentInputSchema.safeParse(contract.runAgentInput);

    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.success).toBe(true);
  });

  it.each(contract.events.map((event) => [event.type, event]))(
    "parses the backend's %s event",
    (_type, event) => {
      const parsed = EventSchemas.safeParse(event);

      expect(parsed.error?.issues).toBeUndefined();
      expect(parsed.success).toBe(true);
    },
  );
});
