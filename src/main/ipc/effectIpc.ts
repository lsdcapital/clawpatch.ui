import type { IpcMainInvokeEvent } from "electron";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { IpcDecodeError, IpcEncodeError } from "../errors";
import { childLogger } from "../logger";

const ipcLogger = childLogger("ipc");

export interface IpcMainLike {
  readonly removeHandler: (channel: string) => void;
  readonly handle: (
    channel: string,
    listener: (event: IpcMainInvokeEvent, raw: unknown) => unknown | Promise<unknown>,
  ) => void;
}

export interface IpcMethod<Payload, EncodedPayload, Result, EncodedResult, E> {
  readonly channel: string;
  readonly payload: Schema.Codec<Payload, EncodedPayload>;
  readonly result: Schema.Codec<Result, EncodedResult>;
  readonly handler: (payload: Payload) => Effect.Effect<Result, E>;
}

export interface EffectIpcShape {
  readonly handle: <Payload, EncodedPayload, Result, EncodedResult, E>(
    method: IpcMethod<Payload, EncodedPayload, Result, EncodedResult, E>,
  ) => Effect.Effect<void>;
}

export class EffectIpc extends Context.Service<EffectIpc, EffectIpcShape>()(
  "clawpatch/EffectIpc",
) {}

export const EffectIpcLive = (
  ipcMain: IpcMainLike,
  runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
) =>
  Layer.succeed(
    EffectIpc,
    EffectIpc.of({
      handle: (method) =>
        Effect.sync(() => {
          ipcMain.removeHandler(method.channel);
          ipcLogger.debug({ channel: method.channel }, "Registering IPC handler");
          ipcMain.handle(method.channel, (_event, raw) =>
            runPromise(
              Schema.decodeUnknownEffect(method.payload)(raw).pipe(
                Effect.mapError((cause) => new IpcDecodeError({ channel: method.channel, cause })),
                Effect.flatMap(method.handler),
                Effect.flatMap((result) =>
                  Schema.encodeUnknownEffect(method.result)(result).pipe(
                    Effect.mapError(
                      (cause) => new IpcEncodeError({ channel: method.channel, cause }),
                    ),
                  ),
                ),
              ),
            ).catch((error: unknown) => {
              ipcLogger.error({ err: error, channel: method.channel }, "IPC handler failed");
              throw error;
            }),
          );
        }).pipe(Effect.withSpan("ipc.handle")),
    }),
  );

export function makeIpcMethod<Payload, EncodedPayload, Result, EncodedResult, E>(
  method: IpcMethod<Payload, EncodedPayload, Result, EncodedResult, E>,
): IpcMethod<Payload, EncodedPayload, Result, EncodedResult, E> {
  return method;
}
