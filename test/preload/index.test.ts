import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMMANDS_INTERRUPT_CHANNEL,
  COMMANDS_STREAM_CHANNEL,
  TERMINAL_OPEN_CHANNEL,
} from "../../src/shared/ipcChannels";
import type { Api } from "../../src/shared/types";

const { exposeInMainWorldMock, invokeMock, onMock, removeListenerMock } = vi.hoisted(() => ({
  exposeInMainWorldMock: vi.fn(),
  invokeMock: vi.fn(),
  onMock: vi.fn(),
  removeListenerMock: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock,
  },
  ipcRenderer: {
    invoke: invokeMock,
    on: onMock,
    removeListener: removeListenerMock,
  },
}));

describe("preload api", () => {
  afterEach(() => {
    exposeInMainWorldMock.mockClear();
    invokeMock.mockReset();
    onMock.mockReset();
    removeListenerMock.mockReset();
    vi.resetModules();
  });

  it("exposes command interrupt over IPC", async () => {
    invokeMock.mockResolvedValue({ interrupted: true });

    await import("../../src/preload/index");

    const api = exposeInMainWorldMock.mock.calls[0]?.[1] as Api | undefined;
    if (api === undefined) {
      throw new Error("preload api was not exposed");
    }

    await expect(api.commands.interrupt("repo-1")).resolves.toEqual({ interrupted: true });
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS_INTERRUPT_CHANNEL, { repoId: "repo-1" });
  });

  it("exposes terminal open over IPC", async () => {
    invokeMock.mockResolvedValue({ cwd: "/tmp/worktree" });

    await import("../../src/preload/index");

    const api = exposeInMainWorldMock.mock.calls[0]?.[1] as Api | undefined;
    if (api === undefined) {
      throw new Error("preload api was not exposed");
    }

    await expect(api.terminal.open("repo-1", "fnd-1")).resolves.toEqual({ cwd: "/tmp/worktree" });
    expect(invokeMock).toHaveBeenCalledWith(TERMINAL_OPEN_CHANNEL, {
      repoId: "repo-1",
      findingId: "fnd-1",
    });
  });

  it("forwards command output and lifecycle stream events", async () => {
    await import("../../src/preload/index");

    const api = exposeInMainWorldMock.mock.calls[0]?.[1] as Api | undefined;
    if (api === undefined) {
      throw new Error("preload api was not exposed");
    }
    const listener = vi.fn();

    const unsubscribe = api.commands.onStream(listener);
    const handler = onMock.mock.calls[0]?.[1] as
      | ((event: unknown, payload: unknown) => void)
      | undefined;
    if (handler === undefined) {
      throw new Error("command stream handler was not registered");
    }

    const outputEvent = { kind: "output", runId: "run-1", stream: "stdout", chunk: "ok\n" };
    const lifecycleEvent = {
      kind: "lifecycle",
      runId: "run-1",
      phase: "git:start",
      message: "$ git status",
      cwd: "/tmp/repo",
      argv: ["git", "status"],
    };
    handler({}, outputEvent);
    handler({}, lifecycleEvent);
    unsubscribe();

    expect(onMock).toHaveBeenCalledWith(COMMANDS_STREAM_CHANNEL, handler);
    expect(listener).toHaveBeenCalledWith(outputEvent);
    expect(listener).toHaveBeenCalledWith(lifecycleEvent);
    expect(removeListenerMock).toHaveBeenCalledWith(COMMANDS_STREAM_CHANNEL, handler);
  });
});
