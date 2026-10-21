import { act, renderHook } from "@testing-library/react";
import {
  __getMockAgent,
  __resetCopilotKitMock,
} from "@/__mocks__/@copilotkit/react-core-v2";
import {
  loadThreadMessages,
  saveThreadMessages,
} from "../helpers/thread-storage";
import { usePersistedThread } from "../hooks/use-persisted-thread";

const hello = { id: "m1", role: "user", content: "hello" };
const reply = { id: "m2", role: "assistant", content: "hi" };

describe("usePersistedThread", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    __resetCopilotKitMock();
  });

  afterEach(() => jest.useRealTimers());

  it("restores the saved transcript into the agent", () => {
    saveThreadMessages("langflow", "t1", [hello, reply]);

    renderHook(() => usePersistedThread("langflow", "t1"));

    const agent = __getMockAgent("langflow");
    expect(agent.threadId).toBe("t1");
    expect(agent.messages).toEqual([hello, reply]);
  });

  it("saves new messages after they settle", () => {
    renderHook(() => usePersistedThread("langflow", "t1"));
    const agent = __getMockAgent("langflow");

    act(() => agent.addMessage(hello));
    expect(loadThreadMessages("langflow", "t1")).toEqual([]);

    act(() => {
      jest.runAllTimers();
    });
    expect(loadThreadMessages("langflow", "t1")).toEqual([hello]);
  });

  it("saves at once when a run ends", () => {
    renderHook(() => usePersistedThread("langflow", "t1"));
    const agent = __getMockAgent("langflow");

    act(() => {
      agent.addMessage(hello);
      agent.setRunning(false);
    });

    expect(loadThreadMessages("langflow", "t1")).toEqual([hello]);
  });

  it("keeps newer in-memory messages when rebinding the same thread", () => {
    saveThreadMessages("langflow", "t1", [hello]);
    const { unmount } = renderHook(() => usePersistedThread("langflow", "t1"));
    const agent = __getMockAgent("langflow");
    unmount();
    // A run finished while nothing was bound to save it.
    agent.messages = [hello, reply];

    renderHook(() => usePersistedThread("langflow", "t1"));

    expect(agent.messages).toEqual([hello, reply]);
  });

  it("switches to another thread's transcript", () => {
    saveThreadMessages("langflow", "t2", [reply]);
    const { rerender } = renderHook(
      ({ threadId }) => usePersistedThread("langflow", threadId),
      { initialProps: { threadId: "t1" } },
    );
    const agent = __getMockAgent("langflow");
    act(() => agent.addMessage(hello));

    rerender({ threadId: "t2" });

    expect(agent.messages).toEqual([reply]);
    // The thread left behind was saved on the way out.
    expect(loadThreadMessages("langflow", "t1")).toEqual([hello]);
  });

  it("does nothing until there is a thread", () => {
    renderHook(() => usePersistedThread("langflow", undefined));

    expect(__getMockAgent("langflow").threadId).toBe("mock-thread");
  });
});
