import {
  clearThreadMessages,
  loadThreadMessages,
  MAX_STORED_MESSAGES,
  MAX_STORED_THREADS,
  newThreadId,
  readAgentId,
  readThreadIds,
  saveThreadMessages,
  writeAgentId,
  writeThreadIds,
} from "../helpers/thread-storage";

describe("thread-storage", () => {
  beforeEach(() => localStorage.clear());

  it("mints thread ids the Playground session list skips", () => {
    const a = newThreadId();
    const b = newThreadId();

    expect(a).toMatch(/^agentic_/);
    expect(a).not.toEqual(b);
  });

  it("round-trips each flow's thread and the chosen agent", () => {
    writeThreadIds({ "flow-1": "agentic_a" });
    writeAgentId("chat");

    expect(readThreadIds()).toEqual({ "flow-1": "agentic_a" });
    expect(readAgentId()).toBe("chat");
  });

  it("ignores corrupt or wrongly shaped stored values", () => {
    localStorage.setItem("langflow-copilot-threads", "{not json");
    localStorage.setItem("langflow-copilot-agent", "42");

    expect(readThreadIds()).toEqual({});
    expect(readAgentId()).toBeNull();
  });

  it("keeps transcripts per agent and thread", () => {
    saveThreadMessages("langflow", "t1", [{ id: "1" }]);
    saveThreadMessages("chat", "t1", [{ id: "2" }]);

    expect(loadThreadMessages("langflow", "t1")).toEqual([{ id: "1" }]);
    expect(loadThreadMessages("chat", "t1")).toEqual([{ id: "2" }]);
    expect(loadThreadMessages("langflow", "missing")).toEqual([]);
  });

  it("keeps only the newest messages of a long transcript", () => {
    const messages = Array.from(
      { length: MAX_STORED_MESSAGES + 5 },
      (_, i) => ({
        id: String(i),
      }),
    );

    saveThreadMessages("chat", "t1", messages);

    const kept = loadThreadMessages<{ id: string }>("chat", "t1");
    expect(kept).toHaveLength(MAX_STORED_MESSAGES);
    expect(kept[0].id).toBe("5");
  });

  it("drops the least recently saved transcript past the limit", () => {
    for (let i = 0; i <= MAX_STORED_THREADS; i++) {
      saveThreadMessages("chat", `t${i}`, [{ id: String(i) }]);
    }

    expect(loadThreadMessages("chat", "t0")).toEqual([]);
    expect(loadThreadMessages("chat", `t${MAX_STORED_THREADS}`)).toHaveLength(
      1,
    );
  });

  it("clears a transcript", () => {
    saveThreadMessages("chat", "t1", [{ id: "1" }]);
    clearThreadMessages("chat", "t1");

    expect(loadThreadMessages("chat", "t1")).toEqual([]);
  });

  it("frees space by dropping old transcripts when storage is full", () => {
    saveThreadMessages("chat", "old", [{ id: "old" }]);
    const realSetItem = Storage.prototype.setItem;
    let failures = 1;
    const spy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (key.endsWith(":new") && failures-- > 0) {
          throw new DOMException("full", "QuotaExceededError");
        }
        return realSetItem.call(this, key, value);
      });

    saveThreadMessages("chat", "new", [{ id: "new" }]);
    spy.mockRestore();

    expect(loadThreadMessages("chat", "old")).toEqual([]);
    expect(loadThreadMessages("chat", "new")).toEqual([{ id: "new" }]);
  });
});
