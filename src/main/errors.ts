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

