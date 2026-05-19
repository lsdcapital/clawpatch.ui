import type { IpcMainInvokeEvent } from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REPO_PICK_FOLDER_CHANNEL
} from "../../src/shared/ipcChannels";
import type {
  ClawpatchCommandRequest,
  CommandResult,
  RepoSummary
} from "../../src/shared/types";
import { RepoService } from "../../src/main/services/repoService";
import { installIpcHandlers } from "../../src/main/ipc/handlers";
import { EffectIpcLive, type IpcMainLike } from "../../src/main/ipc/effectIpc";

const { getAllWindowsMock, getFocusedWindowMock, showOpenDialogMock } = vi.hoisted(() => ({
  getAllWindowsMock: vi.fn(),
  getFocusedWindowMock: vi.fn(),
  showOpenDialogMock: vi.fn()
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
    getFocusedWindow: getFocusedWindowMock
  },
  dialog: {
    showOpenDialog: showOpenDialogMock
  }
}));

describe("IPC handlers", () => {
  beforeEach(() => {
    getAllWindowsMock.mockReset();
    getFocusedWindowMock.mockReset();
    showOpenDialogMock.mockReset();
  });

  it("returns the selected repo folder from the native picker", async () => {
    const focusedWindow = { id: 1 };
    getFocusedWindowMock.mockReturnValue(focusedWindow);
    getAllWindowsMock.mockReturnValue([]);
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/clawpatch-repo"]
    });
    const { listener, runtime } = await installHandlersForTest();

    try {
      await expect(listener({} as IpcMainInvokeEvent, undefined)).resolves.toBe(
        "/tmp/clawpatch-repo"
      );
      expect(showOpenDialogMock).toHaveBeenCalledWith(focusedWindow, {
        properties: ["openDirectory"]
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("returns null when the native picker is canceled", async () => {
    getFocusedWindowMock.mockReturnValue(null);
    getAllWindowsMock.mockReturnValue([]);
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
    const { listener, runtime } = await installHandlersForTest();

    try {
      await expect(listener({} as IpcMainInvokeEvent, undefined)).resolves.toBeNull();
      expect(showOpenDialogMock).toHaveBeenCalledWith({ properties: ["openDirectory"] });
    } finally {
      await runtime.dispose();
    }
  });
});

type RegisteredListener = (event: IpcMainInvokeEvent, raw: unknown) => unknown | Promise<unknown>;

async function installHandlersForTest(): Promise<{
  readonly listener: RegisteredListener;
  readonly runtime: ManagedRuntime.ManagedRuntime<any, any>;
}> {
  const registered = new Map<string, RegisteredListener>();
  const ipcMain: IpcMainLike = {
    removeHandler: vi.fn(),
    handle: vi.fn((channel, listener) => {
      registered.set(channel, listener);
    })
  };
  let runtime: ManagedRuntime.ManagedRuntime<any, any>;
  runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeRepoServiceLayer(),
      EffectIpcLive(ipcMain, (effect) => runtime.runPromise(effect))
    )
  );

  await runtime.runPromise(installIpcHandlers(() => undefined));
  const listener = registered.get(REPO_PICK_FOLDER_CHANNEL);
  if (listener === undefined) {
    throw new Error("repo picker IPC handler was not registered");
  }
  return { listener, runtime };
}

function makeRepoServiceLayer() {
  return Layer.succeed(
    RepoService,
    RepoService.of({
      listRepos: () => Effect.succeed([]),
      addRepo: () => Effect.succeed(makeRepoSummary()),
      refreshRepo: () =>
        Effect.succeed({
          repo: makeRepoSummary(),
          status: {},
          findings: [],
          diff: "",
          metadata: {
            lastSelectedFindingId: null,
            schemaVersion: 1,
            filters: {
              severity: null,
              status: null,
              search: ""
            },
            notes: {},
            updatedAt: "2026-05-19T00:00:00.000Z"
          }
        }),
      listFindings: () => Effect.succeed([]),
      getFinding: () => Effect.die("not implemented"),
      runCommand: () => Effect.succeed(makeCommandResult()),
      setTriage: () => Effect.succeed(makeCommandResult()),
      readDiff: () => Effect.succeed("")
    })
  );
}

function makeRepoSummary(): RepoSummary {
  return {
    id: "repo-1",
    name: "repo",
    path: "/tmp/repo",
    isValid: true,
    hasClawpatch: true,
    findingCount: 0,
    openFindingCount: 0,
    lastError: null,
    updatedAt: "2026-05-19T00:00:00.000Z"
  };
}

function makeCommandResult(): CommandResult {
  return {
    runId: "run-1",
    command: "clawpatch",
    args: ["status"],
    cwd: "/tmp/repo",
    exitCode: 0,
    durationMs: 1,
    stdout: "{}",
    stderr: "",
    parsedJson: {}
  };
}
