import type { IpcMainInvokeEvent } from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMANDS_INTERRUPT_CHANNEL,
  COMMANDS_RUN_CHANNEL,
  REPO_PICK_FOLDER_CHANNEL,
  TERMINAL_OPEN_CHANNEL,
} from "../../src/shared/ipcChannels";
import type {
  CommandResult,
  CommandStreamEvent,
  FeatureMapSnapshot,
  RepoSummary,
} from "../../src/shared/types";
import { RepoService, type RepoServiceShape } from "../../src/main/services/repoService";
import { installIpcHandlers } from "../../src/main/ipc/handlers";
import { EffectIpc, EffectIpcLive, type IpcMainLike } from "../../src/main/ipc/effectIpc";

const { getAllWindowsMock, getFocusedWindowMock, showOpenDialogMock } = vi.hoisted(() => ({
  getAllWindowsMock: vi.fn(),
  getFocusedWindowMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
}));

type TestRuntime = ManagedRuntime.ManagedRuntime<RepoService | EffectIpc, never>;

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
    getFocusedWindow: getFocusedWindowMock,
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
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
      filePaths: ["/tmp/clawpatch-repo"],
    });
    const { listener, runtime } = await installHandlersForTest();

    try {
      await expect(listener({} as IpcMainInvokeEvent, undefined)).resolves.toBe(
        "/tmp/clawpatch-repo",
      );
      expect(showOpenDialogMock).toHaveBeenCalledWith(focusedWindow, {
        properties: ["openDirectory"],
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

  it("maps native picker failures into tagged Effect errors", async () => {
    getFocusedWindowMock.mockReturnValue(null);
    getAllWindowsMock.mockReturnValue([]);
    showOpenDialogMock.mockRejectedValue(new Error("dialog failed"));
    const { listener, runtime } = await installHandlersForTest();

    try {
      await expect(listener({} as IpcMainInvokeEvent, undefined)).rejects.toThrow(
        "Unable to open folder picker",
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("interrupts a running command through IPC", async () => {
    const interruptCommand = vi.fn(() => Effect.succeed({ interrupted: true }));
    const { registered, runtime } = await installHandlersForTest({ interruptCommand });
    const listener = registered.get(COMMANDS_INTERRUPT_CHANNEL);
    if (listener === undefined) {
      throw new Error("command interrupt IPC handler was not registered");
    }

    try {
      await expect(listener({} as IpcMainInvokeEvent, { repoId: "repo-1" })).resolves.toEqual({
        interrupted: true,
      });
      expect(interruptCommand).toHaveBeenCalledWith("repo-1", undefined);
    } finally {
      await runtime.dispose();
    }
  });

  it("publishes lifecycle and output events from command IPC runs", async () => {
    const lifecycleEvent: CommandStreamEvent = {
      kind: "lifecycle",
      runId: "run-1",
      phase: "clawpatch:start",
      message: "$ clawpatch status",
      cwd: "/tmp/repo",
      argv: ["clawpatch", "status"],
    };
    const outputEvent: CommandStreamEvent = {
      kind: "output",
      runId: "run-1",
      stream: "stdout",
      chunk: "{}\n",
    };
    const runCommand = vi.fn<RepoServiceShape["runCommand"]>((_repoId, _request, onStream) =>
      Effect.sync(() => {
        onStream?.(lifecycleEvent);
        onStream?.(outputEvent);
        return makeCommandResult();
      }),
    );
    const publish = vi.fn();
    const { registered, runtime } = await installHandlersForTest({ runCommand, publish });
    const listener = registered.get(COMMANDS_RUN_CHANNEL);
    if (listener === undefined) {
      throw new Error("command run IPC handler was not registered");
    }

    try {
      await expect(
        listener({} as IpcMainInvokeEvent, { repoId: "repo-1", request: { command: "status" } }),
      ).resolves.toMatchObject({ runId: "run-1" });
      expect(publish).toHaveBeenCalledWith(lifecycleEvent);
      expect(publish).toHaveBeenCalledWith(outputEvent);
    } finally {
      await runtime.dispose();
    }
  });

  it("opens a terminal through IPC", async () => {
    const openTerminal = vi.fn(() => Effect.succeed({ cwd: "/tmp/repo" }));
    const { registered, runtime } = await installHandlersForTest({ openTerminal });
    const listener = registered.get(TERMINAL_OPEN_CHANNEL);
    if (listener === undefined) {
      throw new Error("terminal open IPC handler was not registered");
    }

    try {
      await expect(
        listener({} as IpcMainInvokeEvent, { repoId: "repo-1", findingId: "fnd-1" }),
      ).resolves.toEqual({ cwd: "/tmp/repo" });
      expect(openTerminal).toHaveBeenCalledWith("repo-1", "fnd-1");
    } finally {
      await runtime.dispose();
    }
  });
});

type RegisteredListener = (event: IpcMainInvokeEvent, raw: unknown) => unknown | Promise<unknown>;

async function installHandlersForTest(): Promise<{
  readonly registered: Map<string, RegisteredListener>;
  readonly listener: RegisteredListener;
  readonly runtime: TestRuntime;
}>;
async function installHandlersForTest(options: {
  readonly interruptCommand?: RepoServiceShape["interruptCommand"];
  readonly openTerminal?: RepoServiceShape["openTerminal"];
  readonly publish?: (event: CommandStreamEvent) => void;
  readonly runCommand?: RepoServiceShape["runCommand"];
}): Promise<{
  readonly registered: Map<string, RegisteredListener>;
  readonly listener: RegisteredListener;
  readonly runtime: TestRuntime;
}>;
async function installHandlersForTest(
  options: {
    readonly interruptCommand?: RepoServiceShape["interruptCommand"];
    readonly openTerminal?: RepoServiceShape["openTerminal"];
    readonly publish?: (event: CommandStreamEvent) => void;
    readonly runCommand?: RepoServiceShape["runCommand"];
  } = {},
): Promise<{
  readonly registered: Map<string, RegisteredListener>;
  readonly listener: RegisteredListener;
  readonly runtime: TestRuntime;
}> {
  const registered = new Map<string, RegisteredListener>();
  const ipcMain: IpcMainLike = {
    removeHandler: vi.fn(),
    handle: vi.fn((channel, listener) => {
      registered.set(channel, listener);
    }),
  };
  let runtime: TestRuntime;
  runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeRepoServiceLayer(options),
      EffectIpcLive(ipcMain, (effect) => runtime.runPromise(effect)),
    ),
  );

  await runtime.runPromise(installIpcHandlers(options.publish ?? (() => undefined)));
  const listener = registered.get(REPO_PICK_FOLDER_CHANNEL);
  if (listener === undefined) {
    throw new Error("repo picker IPC handler was not registered");
  }
  return { registered, listener, runtime };
}

function makeRepoServiceLayer(
  options: {
    readonly interruptCommand?: RepoServiceShape["interruptCommand"];
    readonly openTerminal?: RepoServiceShape["openTerminal"];
    readonly runCommand?: RepoServiceShape["runCommand"];
  } = {},
) {
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
              search: "",
            },
            updatedAt: "2026-05-19T00:00:00.000Z",
          },
        }),
      listFindings: () => Effect.succeed([]),
      readFeatureMap: () => Effect.succeed(makeFeatureMapSnapshot()),
      getFinding: () => Effect.die("not implemented"),
      runCommand: options.runCommand ?? (() => Effect.succeed(makeCommandResult())),
      interruptCommand: options.interruptCommand ?? (() => Effect.succeed({ interrupted: false })),
      setTriage: () => Effect.succeed(makeCommandResult()),
      readDiff: () => Effect.succeed(""),
      readGitStatus: () => Effect.succeed({ staged: 0, modified: 0, untracked: 0, branch: null }),
      openTerminal: options.openTerminal ?? ((cwd) => Effect.succeed({ cwd })),
    }),
  );
}

function makeRepoSummary(): RepoSummary {
  return {
    id: "repo-1",
    name: "repo",
    path: "/tmp/repo",
    activeWorktreePath: null,
    activeWorktrees: [],
    isValid: true,
    hasClawpatch: true,
    findingCount: 0,
    openFindingCount: 0,
    lastError: null,
    updatedAt: "2026-05-19T00:00:00.000Z",
  };
}

function makeFeatureMapSnapshot(): FeatureMapSnapshot {
  return {
    features: [],
    coverage: {
      totalFeatures: 0,
      pendingReviewCount: 0,
      pendingReviewFeatureIds: [],
      latestReviewRun: null,
      latestLimitedReviewRun: null,
      hasLimitedReviewRemainder: false,
    },
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
    parsedJson: {},
  };
}
