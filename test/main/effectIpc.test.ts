import type { IpcMainInvokeEvent } from "electron";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import {
  EffectIpc,
  EffectIpcLive,
  makeIpcMethod,
  type IpcMainLike,
} from "../../src/main/ipc/effectIpc";

type IpcRuntime = ManagedRuntime.ManagedRuntime<EffectIpc, never>;
type RegisteredListener = (event: IpcMainInvokeEvent, raw: unknown) => unknown | Promise<unknown>;

describe("EffectIpc", () => {
  it("decodes payloads before running handlers", async () => {
    let listener: RegisteredListener | undefined;
    const ipcMain: IpcMainLike = {
      removeHandler: vi.fn(),
      handle: vi.fn((_channel, nextListener) => {
        listener = nextListener;
      }),
    };
    let runtime: IpcRuntime;
    runtime = ManagedRuntime.make(EffectIpcLive(ipcMain, (effect) => runtime.runPromise(effect)));

    await runtime.runPromise(
      Effect.gen(function* () {
        const ipc = yield* EffectIpc;
        yield* ipc.handle(
          makeIpcMethod({
            channel: "test:decode",
            payload: Schema.Struct({ repoId: Schema.String }),
            result: Schema.String,
            handler: ({ repoId }) => Effect.succeed(repoId),
          }),
        );
      }),
    );

    expect(listener).toBeDefined();
    const registered = listener;
    if (registered === undefined) {
      throw new Error("IPC listener was not registered");
    }
    await expect(registered({} as IpcMainInvokeEvent, { repoId: 123 })).rejects.toThrow(
      "Invalid IPC payload for test:decode",
    );
    await expect(registered({} as IpcMainInvokeEvent, { repoId: "repo-1" })).resolves.toBe(
      "repo-1",
    );

    await runtime.dispose();
  });

  it("encodes handler results before resolving", async () => {
    let listener: RegisteredListener | undefined;
    const ipcMain: IpcMainLike = {
      removeHandler: vi.fn(),
      handle: vi.fn((_channel, nextListener) => {
        listener = nextListener;
      }),
    };
    let runtime: IpcRuntime;
    runtime = ManagedRuntime.make(EffectIpcLive(ipcMain, (effect) => runtime.runPromise(effect)));

    await runtime.runPromise(
      Effect.gen(function* () {
        const ipc = yield* EffectIpc;
        yield* ipc.handle(
          makeIpcMethod({
            channel: "test:encode",
            payload: Schema.Void,
            result: Schema.Number,
            handler: () => Effect.succeed("not-a-number" as unknown as number),
          }),
        );
      }),
    );

    const registered = listener;
    if (registered === undefined) {
      throw new Error("IPC listener was not registered");
    }
    await expect(registered({} as IpcMainInvokeEvent, undefined)).rejects.toThrow(
      "Invalid IPC result for test:encode",
    );

    await runtime.dispose();
  });

  it("propagates handler failures", async () => {
    let listener: RegisteredListener | undefined;
    const ipcMain: IpcMainLike = {
      removeHandler: vi.fn(),
      handle: vi.fn((_channel, nextListener) => {
        listener = nextListener;
      }),
    };
    let runtime: IpcRuntime;
    runtime = ManagedRuntime.make(EffectIpcLive(ipcMain, (effect) => runtime.runPromise(effect)));

    await runtime.runPromise(
      Effect.gen(function* () {
        const ipc = yield* EffectIpc;
        yield* ipc.handle(
          makeIpcMethod({
            channel: "test:failure",
            payload: Schema.Void,
            result: Schema.String,
            handler: () => Effect.fail(new Error("handler failed")),
          }),
        );
      }),
    );

    const registered = listener;
    if (registered === undefined) {
      throw new Error("IPC listener was not registered");
    }
    await expect(registered({} as IpcMainInvokeEvent, undefined)).rejects.toThrow("handler failed");

    await runtime.dispose();
  });
});
