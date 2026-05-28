import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_SETTINGS_GET_CHANNEL,
  APP_SETTINGS_PICK_TERMINAL_APP_CHANNEL,
  APP_SETTINGS_UPDATE_CHANNEL,
  COMMANDS_INTERRUPT_CHANNEL,
  COMMANDS_STREAM_CHANNEL,
  FINDINGS_WORK_STATUSES_CHANNEL,
  PATCHES_OPEN_PR_CHANNEL,
  REPO_DOCTOR_CHANNEL,
  REPO_GET_CONFIG_CHANNEL,
  REPO_GET_SETTINGS_CHANNEL,
  REPO_UPDATE_CONFIG_CHANNEL,
  REPO_UPDATE_SETTINGS_CHANNEL,
  TERMINAL_OPEN_CHANNEL,
} from "../../src/shared/ipcChannels";
import type { Api } from "../../src/shared/types";

const { exposeInMainWorldMock, invokeMock, onMock, removeListenerMock } = vi.hoisted(() => ({
  exposeInMainWorldMock: vi.fn(),
  invokeMock: vi.fn(),
  onMock: vi.fn(),
  removeListenerMock: vi.fn(),
}));

vi.mock("../../src/shared/electronRuntime", () => {
  const electronMock = {
    contextBridge: {
      exposeInMainWorld: exposeInMainWorldMock,
    },
    ipcRenderer: {
      invoke: invokeMock,
      on: onMock,
      removeListener: removeListenerMock,
    },
  };
  return { requireElectron: () => electronMock };
});

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

  it("exposes patch PR opening over IPC", async () => {
    invokeMock.mockResolvedValue({
      worktreePath: "/tmp/worktree",
      patchAttemptId: "pat-1",
      commandResult: {
        runId: "run-1",
        command: "clawpatch",
        args: ["open-pr"],
        cwd: "/tmp/worktree",
        exitCode: 0,
        durationMs: 1,
        stdout: "{}",
        stderr: "",
        parsedJson: {},
      },
      prUrl: "https://github.com/acme/repo/pull/42",
    });

    await import("../../src/preload/index");

    const api = exposeInMainWorldMock.mock.calls[0]?.[1] as Api | undefined;
    if (api === undefined) {
      throw new Error("preload api was not exposed");
    }

    await expect(api.patches.openPr("repo-1", "fnd-1")).resolves.toMatchObject({
      patchAttemptId: "pat-1",
    });
    expect(invokeMock).toHaveBeenCalledWith(PATCHES_OPEN_PR_CHANNEL, {
      repoId: "repo-1",
      findingId: "fnd-1",
    });
  });

  it("exposes finding work statuses over IPC", async () => {
    invokeMock.mockResolvedValue([
      {
        findingId: "fnd-1",
        worktreePath: "/tmp/worktree",
        gitStatus: { staged: 0, modified: 1, untracked: 0, branch: "clawpatch/fix/fnd-1" },
        prUrl: null,
        error: null,
      },
    ]);

    await import("../../src/preload/index");

    const api = exposeInMainWorldMock.mock.calls[0]?.[1] as Api | undefined;
    if (api === undefined) {
      throw new Error("preload api was not exposed");
    }

    await expect(api.findings.workStatuses("repo-1")).resolves.toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith(FINDINGS_WORK_STATUSES_CHANNEL, { repoId: "repo-1" });
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

  it("exposes repo settings over IPC", async () => {
    invokeMock.mockResolvedValue({
      schemaVersion: 1,
      terminalStartupScript: "",
      worktreeSetupScript: "pnpm install",
      updatedAt: "2026-05-19T00:00:00.000Z",
    });

    await import("../../src/preload/index");

    const api = exposeInMainWorldMock.mock.calls[0]?.[1] as Api | undefined;
    if (api === undefined) {
      throw new Error("preload api was not exposed");
    }
    const settings = {
      schemaVersion: 1 as const,
      terminalStartupScript: "",
      worktreeSetupScript: "pnpm install",
      updatedAt: "2026-05-19T00:00:00.000Z",
    };

    await expect(api.repo.getSettings("repo-1")).resolves.toMatchObject({
      worktreeSetupScript: "pnpm install",
    });
    await expect(api.repo.updateSettings("repo-1", settings)).resolves.toMatchObject({
      worktreeSetupScript: "pnpm install",
    });
    expect(invokeMock).toHaveBeenCalledWith(REPO_GET_SETTINGS_CHANNEL, { repoId: "repo-1" });
    expect(invokeMock).toHaveBeenCalledWith(REPO_UPDATE_SETTINGS_CHANNEL, {
      repoId: "repo-1",
      settings,
    });
  });

  it("exposes shared Clawpatch config over IPC", async () => {
    invokeMock.mockResolvedValue({
      schemaVersion: 1,
      stateTracking: "team",
    });

    await import("../../src/preload/index");

    const api = exposeInMainWorldMock.mock.calls[0]?.[1] as Api | undefined;
    if (api === undefined) {
      throw new Error("preload api was not exposed");
    }
    const config = {
      schemaVersion: 1 as const,
      stateTracking: "audit" as const,
    };

    await expect(api.repo.getConfig("repo-1")).resolves.toMatchObject({
      stateTracking: "team",
    });
    await expect(api.repo.updateConfig("repo-1", config)).resolves.toMatchObject({
      stateTracking: "team",
    });
    expect(invokeMock).toHaveBeenCalledWith(REPO_GET_CONFIG_CHANNEL, { repoId: "repo-1" });
    expect(invokeMock).toHaveBeenCalledWith(REPO_UPDATE_CONFIG_CHANNEL, {
      repoId: "repo-1",
      config,
    });
  });

  it("exposes app settings over IPC", async () => {
    invokeMock.mockResolvedValue({
      schemaVersion: 1,
      terminalAppName: "iTerm",
      terminalAppPath: "/Applications/iTerm.app",
      updatedAt: "2026-05-19T00:00:00.000Z",
    });

    await import("../../src/preload/index");

    const api = exposeInMainWorldMock.mock.calls[0]?.[1] as Api | undefined;
    if (api === undefined) {
      throw new Error("preload api was not exposed");
    }
    const settings = {
      schemaVersion: 1 as const,
      terminalAppName: "Terminal",
      terminalAppPath: null,
      updatedAt: "2026-05-19T00:00:00.000Z",
    };

    await expect(api.appSettings.get()).resolves.toMatchObject({
      terminalAppName: "iTerm",
    });
    await expect(api.appSettings.update(settings)).resolves.toMatchObject({
      terminalAppName: "iTerm",
    });
    expect(invokeMock).toHaveBeenCalledWith(APP_SETTINGS_GET_CHANNEL);
    expect(invokeMock).toHaveBeenCalledWith(APP_SETTINGS_UPDATE_CHANNEL, { settings });
  });

  it("exposes terminal app picking over IPC", async () => {
    invokeMock.mockResolvedValue("/Applications/iTerm.app");

    await import("../../src/preload/index");

    const api = exposeInMainWorldMock.mock.calls[0]?.[1] as Api | undefined;
    if (api === undefined) {
      throw new Error("preload api was not exposed");
    }

    await expect(api.appSettings.pickTerminalApp()).resolves.toBe("/Applications/iTerm.app");
    expect(invokeMock).toHaveBeenCalledWith(APP_SETTINGS_PICK_TERMINAL_APP_CHANNEL);
  });

  it("exposes repo doctor diagnostics over IPC", async () => {
    invokeMock.mockResolvedValue({
      runId: "run-doctor",
      command: "clawpatch",
      args: ["doctor"],
      cwd: "/tmp/repo",
      exitCode: 0,
      durationMs: 1,
      stdout: "{}",
      stderr: "",
      parsedJson: {},
    });

    await import("../../src/preload/index");

    const api = exposeInMainWorldMock.mock.calls[0]?.[1] as Api | undefined;
    if (api === undefined) {
      throw new Error("preload api was not exposed");
    }

    await expect(api.repo.doctor("repo-1")).resolves.toMatchObject({
      runId: "run-doctor",
      args: ["doctor"],
    });
    expect(invokeMock).toHaveBeenCalledWith(REPO_DOCTOR_CHANNEL, { repoId: "repo-1" });
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
