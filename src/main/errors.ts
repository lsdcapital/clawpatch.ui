import * as Data from "effect/Data";

export class InvalidRepoPathError extends Data.TaggedError("InvalidRepoPathError")<{
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export class RepoNotFoundError extends Data.TaggedError("RepoNotFoundError")<{
  readonly repoId: string;
}> {
  override get message() {
    return `Repo not found: ${this.repoId}`;
  }
}

export class JsonDecodeError extends Data.TaggedError("JsonDecodeError")<{
  readonly path: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Failed to decode JSON: ${this.path}`;
  }
}

export class FindingNotFoundError extends Data.TaggedError("FindingNotFoundError")<{
  readonly findingId: string;
}> {
  override get message() {
    return `Finding not found: ${this.findingId}`;
  }
}

export class CommandValidationError extends Data.TaggedError("CommandValidationError")<{
  readonly message: string;
}> {}

export class CommandAlreadyRunningError extends Data.TaggedError("CommandAlreadyRunningError")<{
  readonly repoPath: string;
}> {
  override get message() {
    return "A Clawpatch command is already running for this repo";
  }
}

export class CommandSpawnError extends Data.TaggedError("CommandSpawnError")<{
  readonly repoPath: string;
  readonly cause: unknown;
}> {
  override get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}

export class CommandExecutionError extends Data.TaggedError("CommandExecutionError")<{
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  override get message() {
    const details = [
      `clawpatch ${this.command} failed with exit ${this.exitCode ?? "unknown"}`,
      this.stderr.trim() === "" ? null : `stderr: ${this.stderr.trim()}`,
      this.stdout.trim() === "" ? null : `stdout: ${this.stdout.trim()}`,
    ].filter((line): line is string => line !== null);
    return details.join("\n");
  }
}

export class TerminalCwdError extends Data.TaggedError("TerminalCwdError")<{
  readonly cwd: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class TerminalUnsupportedPlatformError extends Data.TaggedError(
  "TerminalUnsupportedPlatformError",
)<{
  readonly platform: NodeJS.Platform;
}> {
  override get message() {
    return "Opening Terminal is only supported on macOS for now";
  }
}

export class TerminalStartupScriptUnsupportedError extends Data.TaggedError(
  "TerminalStartupScriptUnsupportedError",
)<{
  readonly appName: string;
}> {
  override get message() {
    return "Terminal startup scripts are only supported with Terminal.app and Ghostty for now";
  }
}

export class TerminalLaunchError extends Data.TaggedError("TerminalLaunchError")<{
  readonly cwd: string;
  readonly cause: unknown;
}> {
  override get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}

export class DialogOpenError extends Data.TaggedError("DialogOpenError")<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Unable to open folder picker";
  }
}

export class IpcDecodeError extends Data.TaggedError("IpcDecodeError")<{
  readonly channel: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Invalid IPC payload for ${this.channel}`;
  }
}

export class IpcEncodeError extends Data.TaggedError("IpcEncodeError")<{
  readonly channel: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Invalid IPC result for ${this.channel}`;
  }
}
