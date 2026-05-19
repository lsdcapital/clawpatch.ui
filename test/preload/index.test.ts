import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMANDS_INTERRUPT_CHANNEL } from "../../src/shared/ipcChannels";
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
});
