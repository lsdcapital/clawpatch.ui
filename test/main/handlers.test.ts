import type { IpcMainInvokeEvent } from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_SETTINGS_GET_CHANNEL,
  APP_SETTINGS_PICK_TERMINAL_APP_CHANNEL,
  APP_SETTINGS_UPDATE_CHANNEL,
  COMMANDS_INTERRUPT_CHANNEL,
  COMMANDS_RUN_CHANNEL,
  FINDINGS_WORK_STATUSES_CHANNEL,
  GIT_PUBLISH_FIX_CHANNEL,
  REPO_DOCTOR_CHANNEL,
  REPO_GET_SETTINGS_CHANNEL,
  REPO_PICK_FOLDER_CHANNEL,
  REPO_UPDATE_SETTINGS_CHANNEL,
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

const { getAllWindowsMock, getFocusedWindowMock, showOpenDialogMock, openExternalMock } =
  vi.hoisted(() => ({
    getAllWindowsMock: vi.fn(),
    getFocusedWindowMock: vi.fn(),
    showOpenDialogMock: vi.fn(),
    openExternalMock: vi.fn(),
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
  shell: {
    openExternal: openExternalMock,
  },
}));

describe("IPC handlers", () => {
  beforeEach(() => {
    getAllWindowsMock.mockReset();
    getFocusedWindowMock.mockReset();
    showOpenDialogMock.mockReset();
    openExternalMock.mockReset();
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

  it("returns the selected terminal app from the native app picker", async () => {
    getFocusedWindowMock.mockReturnValue(null);
    getAllWindowsMock.mockReturnValue([]);
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ["/Applications/iTerm.app"],
    });
    const { registered, runtime } = await installHandlersForTest();
    const listener = registered.get(APP_SETTINGS_PICK_TERMINAL_APP_CHANNEL);
    if (listener === undefined) {
      throw new Error("terminal app picker IPC handler was not registered");
    }

    try {
      await expect(listener({} as IpcMainInvokeEvent, undefined)).resolves.toBe(
        "/Applications/iTerm.app",
      );
      expect(showOpenDialogMock).toHaveBeenCalledWith({
        title: "Choose Terminal App",
        buttonLabel: "Choose",
        defaultPath: "/Applications",
        filters: [{ name: "Applications", extensions: ["app"] }],
        properties: ["openFile"],
      });
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

  it("returns repo Doctor diagnostics without publishing command stream events", async () => {
    const doctor = vi.fn<RepoServiceShape["doctor"]>(() =>
      Effect.succeed({ ...makeCommandResult(), args: ["doctor"], parsedJson: { ok: true } }),
    );
    const publish = vi.fn();
    const { registered, runtime } = await installHandlersForTest({ doctor, publish });
    const listener = registered.get(REPO_DOCTOR_CHANNEL);
    if (listener === undefined) {
      throw new Error("repo doctor IPC handler was not registered");
    }

    try {
      await expect(listener({} as IpcMainInvokeEvent, { repoId: "repo-1" })).resolves.toMatchObject(
        { args: ["doctor"], parsedJson: { ok: true } },
      );
      expect(doctor).toHaveBeenCalledWith("repo-1");
      expect(publish).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it("returns finding work statuses through IPC", async () => {
    const listFindingWorkStatuses = vi.fn<RepoServiceShape["listFindingWorkStatuses"]>(() =>
      Effect.succeed([
        {
          findingId: "fnd-1",
          worktreePath: "/tmp/worktree",
          gitStatus: { staged: 0, modified: 1, untracked: 0, branch: "clawpatch/fix/fnd-1" },
          prUrl: null,
          error: null,
        },
      ]),
    );
    const { registered, runtime } = await installHandlersForTest({ listFindingWorkStatuses });
    const listener = registered.get(FINDINGS_WORK_STATUSES_CHANNEL);
    if (listener === undefined) {
      throw new Error("finding work statuses IPC handler was not registered");
    }

    try {
      await expect(listener({} as IpcMainInvokeEvent, { repoId: "repo-1" })).resolves.toHaveLength(
        1,
      );
      expect(listFindingWorkStatuses).toHaveBeenCalledWith("repo-1");
    } finally {
      await runtime.dispose();
    }
  });

  it("opens the GitHub PR page after publishing a fix", async () => {
    openExternalMock.mockResolvedValue(undefined);
    const publishFix = vi.fn<RepoServiceShape["publishFix"]>(() =>
      Effect.succeed({
        worktreePath: "/tmp/worktree",
        branchName: "clawpatch/fix/fnd-1",
        baseBranch: "main",
        commitSha: "abc123",
        remoteName: "origin",
        prUrl: "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-1?expand=1",
      }),
    );
    const { registered, runtime } = await installHandlersForTest({ publishFix });
    const listener = registered.get(GIT_PUBLISH_FIX_CHANNEL);
    if (listener === undefined) {
      throw new Error("publish fix IPC handler was not registered");
    }

    try {
      await expect(
        listener({} as IpcMainInvokeEvent, { repoId: "repo-1", findingId: "fnd-1" }),
      ).resolves.toMatchObject({ branchName: "clawpatch/fix/fnd-1" });
      expect(publishFix).toHaveBeenCalledWith("repo-1", "fnd-1");
      expect(openExternalMock).toHaveBeenCalledWith(
        "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-1?expand=1",
      );
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

  it("reads and updates repo settings through IPC", async () => {
    const getSettings = vi.fn<RepoServiceShape["getSettings"]>(() =>
      Effect.succeed({
        schemaVersion: 1,
        terminalStartupScript: "pnpm dev",
        worktreeSetupScript: "pnpm install",
        updatedAt: "2026-05-19T00:00:00.000Z",
      }),
    );
    const updateSettings = vi.fn<RepoServiceShape["updateSettings"]>((_repoId, settings) =>
      Effect.succeed({ ...settings, updatedAt: "2026-05-20T00:00:00.000Z" }),
    );
    const { registered, runtime } = await installHandlersForTest({ getSettings, updateSettings });
    const getListener = registered.get(REPO_GET_SETTINGS_CHANNEL);
    const updateListener = registered.get(REPO_UPDATE_SETTINGS_CHANNEL);
    if (getListener === undefined || updateListener === undefined) {
      throw new Error("repo settings IPC handlers were not registered");
    }

    const settings = {
      schemaVersion: 1 as const,
      terminalStartupScript: "",
      worktreeSetupScript: "pnpm install",
      updatedAt: "2026-05-19T00:00:00.000Z",
    };

    try {
      await expect(
        getListener({} as IpcMainInvokeEvent, { repoId: "repo-1" }),
      ).resolves.toMatchObject({ terminalStartupScript: "pnpm dev" });
      await expect(
        updateListener({} as IpcMainInvokeEvent, { repoId: "repo-1", settings }),
      ).resolves.toMatchObject({ worktreeSetupScript: "pnpm install" });
      expect(getSettings).toHaveBeenCalledWith("repo-1");
      expect(updateSettings).toHaveBeenCalledWith("repo-1", settings);
    } finally {
      await runtime.dispose();
    }
  });

  it("reads and updates app settings through IPC", async () => {
    const getAppSettings = vi.fn<RepoServiceShape["getAppSettings"]>(() =>
      Effect.succeed({
        schemaVersion: 1,
        terminalAppName: "iTerm",
        terminalAppPath: "/Applications/iTerm.app",
        updatedAt: "2026-05-19T00:00:00.000Z",
      }),
    );
    const updateAppSettings = vi.fn<RepoServiceShape["updateAppSettings"]>((settings) =>
      Effect.succeed({ ...settings, updatedAt: "2026-05-20T00:00:00.000Z" }),
    );
    const { registered, runtime } = await installHandlersForTest({
      getAppSettings,
      updateAppSettings,
    });
    const getListener = registered.get(APP_SETTINGS_GET_CHANNEL);
    const updateListener = registered.get(APP_SETTINGS_UPDATE_CHANNEL);
    if (getListener === undefined || updateListener === undefined) {
      throw new Error("app settings IPC handlers were not registered");
    }

    const settings = {
      schemaVersion: 1 as const,
      terminalAppName: "Terminal",
      terminalAppPath: null,
      updatedAt: "2026-05-19T00:00:00.000Z",
    };

    try {
      await expect(getListener({} as IpcMainInvokeEvent, undefined)).resolves.toMatchObject({
        terminalAppName: "iTerm",
      });
      await expect(updateListener({} as IpcMainInvokeEvent, { settings })).resolves.toMatchObject({
        terminalAppName: "Terminal",
      });
      expect(getAppSettings).toHaveBeenCalledWith();
      expect(updateAppSettings).toHaveBeenCalledWith(settings);
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
  readonly doctor?: RepoServiceShape["doctor"];
  readonly getAppSettings?: RepoServiceShape["getAppSettings"];
  readonly interruptCommand?: RepoServiceShape["interruptCommand"];
  readonly openTerminal?: RepoServiceShape["openTerminal"];
  readonly publish?: (event: CommandStreamEvent) => void;
  readonly publishFix?: RepoServiceShape["publishFix"];
  readonly getSettings?: RepoServiceShape["getSettings"];
  readonly listFindingWorkStatuses?: RepoServiceShape["listFindingWorkStatuses"];
  readonly updateSettings?: RepoServiceShape["updateSettings"];
  readonly updateAppSettings?: RepoServiceShape["updateAppSettings"];
  readonly runCommand?: RepoServiceShape["runCommand"];
}): Promise<{
  readonly registered: Map<string, RegisteredListener>;
  readonly listener: RegisteredListener;
  readonly runtime: TestRuntime;
}>;
async function installHandlersForTest(
  options: {
    readonly doctor?: RepoServiceShape["doctor"];
    readonly getAppSettings?: RepoServiceShape["getAppSettings"];
    readonly interruptCommand?: RepoServiceShape["interruptCommand"];
    readonly openTerminal?: RepoServiceShape["openTerminal"];
    readonly publish?: (event: CommandStreamEvent) => void;
    readonly publishFix?: RepoServiceShape["publishFix"];
    readonly getSettings?: RepoServiceShape["getSettings"];
    readonly listFindingWorkStatuses?: RepoServiceShape["listFindingWorkStatuses"];
    readonly updateSettings?: RepoServiceShape["updateSettings"];
    readonly updateAppSettings?: RepoServiceShape["updateAppSettings"];
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
    readonly doctor?: RepoServiceShape["doctor"];
    readonly getAppSettings?: RepoServiceShape["getAppSettings"];
    readonly interruptCommand?: RepoServiceShape["interruptCommand"];
    readonly openTerminal?: RepoServiceShape["openTerminal"];
    readonly publishFix?: RepoServiceShape["publishFix"];
    readonly getSettings?: RepoServiceShape["getSettings"];
    readonly listFindingWorkStatuses?: RepoServiceShape["listFindingWorkStatuses"];
    readonly updateSettings?: RepoServiceShape["updateSettings"];
    readonly updateAppSettings?: RepoServiceShape["updateAppSettings"];
    readonly runCommand?: RepoServiceShape["runCommand"];
  } = {},
) {
  return Layer.succeed(
    RepoService,
    RepoService.of({
      getAppSettings:
        options.getAppSettings ??
        (() =>
          Effect.succeed({
            schemaVersion: 1,
            terminalAppName: "Terminal",
            terminalAppPath: null,
            updatedAt: "2026-05-19T00:00:00.000Z",
          })),
      updateAppSettings:
        options.updateAppSettings ??
        ((settings) =>
          Effect.succeed({
            ...settings,
            schemaVersion: 1 as const,
            updatedAt: "2026-05-19T00:00:00.000Z",
          })),
      listRepos: () => Effect.succeed([]),
      addRepo: () => Effect.succeed(makeRepoSummary()),
      refreshRepo: () =>
        Effect.succeed({
          repo: makeRepoSummary(),
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
      getSettings:
        options.getSettings ??
        (() =>
          Effect.succeed({
            schemaVersion: 1,
            terminalStartupScript: "",
            worktreeSetupScript: "",
            updatedAt: "2026-05-19T00:00:00.000Z",
          })),
      updateSettings:
        options.updateSettings ??
        ((_repoId, settings) =>
          Effect.succeed({
            ...settings,
            schemaVersion: 1 as const,
            updatedAt: "2026-05-19T00:00:00.000Z",
          })),
      listFindings: () => Effect.succeed([]),
      listFindingWorkStatuses: options.listFindingWorkStatuses ?? (() => Effect.succeed([])),
      doctor: options.doctor ?? (() => Effect.succeed(makeCommandResult())),
      readFeatureMap: () => Effect.succeed(makeFeatureMapSnapshot()),
      getFinding: () => Effect.die("not implemented"),
      runCommand: options.runCommand ?? (() => Effect.succeed(makeCommandResult())),
      interruptCommand: options.interruptCommand ?? (() => Effect.succeed({ interrupted: false })),
      setTriage: () => Effect.succeed(makeCommandResult()),
      readDiff: () => Effect.succeed(""),
      readGitStatus: () => Effect.succeed({ staged: 0, modified: 0, untracked: 0, branch: null }),
      publishFix:
        options.publishFix ??
        (() =>
          Effect.succeed({
            worktreePath: "/tmp/worktree",
            branchName: "clawpatch/fix/fnd-1",
            baseBranch: "main",
            commitSha: "abc123",
            remoteName: "origin",
            prUrl: "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-1?expand=1",
          })),
      openTerminal: options.openTerminal ?? (() => Effect.succeed({ cwd: "/tmp/repo" })),
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
