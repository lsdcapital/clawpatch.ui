import type { IpcMainInvokeEvent } from "electron";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import { EffectIpc, EffectIpcLive, makeIpcMethod, type IpcMainLike } from "../../src/main/ipc/effectIpc";

describe("EffectIpc", () => {
  it("decodes payloads before running handlers", async () => {
    type RegisteredListener = (event: IpcMainInvokeEvent, raw: unknown) => unknown | Promise<unknown>;
    let listener: RegisteredListener | undefined;
    const ipcMain: IpcMainLike = {
      removeHandler: vi.fn(),
      handle: vi.fn((_channel, nextListener) => {
        listener = nextListener;
      })
    };
    let runtime: ManagedRuntime.ManagedRuntime<any, any>;
    runtime = ManagedRuntime.make(EffectIpcLive(ipcMain, (effect) => runtime.runPromise(effect)));

    await runtime.runPromise(
      Effect.gen(function* () {
        const ipc = yield* EffectIpc;
        yield* ipc.handle(
          makeIpcMethod({
            channel: "test:decode",
            payload: Schema.Struct({ repoId: Schema.String }),
            result: Schema.String,
            handler: ({ repoId }) => Effect.succeed(repoId)
          })
        );
      })
    );

    expect(listener).toBeDefined();
    const registered = listener;
    if (registered === undefined) {
      throw new Error("IPC listener was not registered");
    }
    await expect(registered({} as IpcMainInvokeEvent, { repoId: 123 })).rejects.toThrow(
      "Invalid IPC payload for test:decode"
    );
    await expect(registered({} as IpcMainInvokeEvent, { repoId: "repo-1" })).resolves.toBe(
      "repo-1"
    );

    await runtime.dispose();
  });
});
