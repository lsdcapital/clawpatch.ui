import * as Effect from "effect/Effect";
import { ClawpatchRunner } from "./services/clawpatchRunner";

export interface AppRuntimeCleanup<R = never> {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
  readonly dispose: () => Promise<void>;
}

export interface BeforeQuitEventLike {
  readonly preventDefault: () => void;
}

export type ShutdownLogger = (message: string, error: unknown) => void;
export const shutdownSignals = ["SIGINT", "SIGTERM"] as const;
export type ShutdownSignal = (typeof shutdownSignals)[number];

export type ShutdownSignalLogger = (signal: ShutdownSignal, forced: boolean) => void;

export async function cleanupAppRuntime(
  runtime: AppRuntimeCleanup<ClawpatchRunner>,
  logError: ShutdownLogger = (message, error) => console.error(message, error),
): Promise<void> {
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const runner = yield* ClawpatchRunner;
        yield* runner.interruptAll();
      }),
    );
  } catch (error) {
    logError("Unable to interrupt running Clawpatch commands", error);
  }

  try {
    await runtime.dispose();
  } catch (error) {
    logError("Unable to dispose app runtime", error);
  }
}

export function makeBeforeQuitHandler(input: {
  readonly getRuntime: () => AppRuntimeCleanup<ClawpatchRunner> | null;
  readonly clearRuntime: () => void;
  readonly quit: () => void;
  readonly logError?: ShutdownLogger;
}): (event: BeforeQuitEventLike) => void {
  let canQuit = false;
  let cleanupPromise: Promise<void> | null = null;

  return (event) => {
    if (canQuit) {
      return;
    }

    if (cleanupPromise !== null) {
      event.preventDefault();
      return;
    }

    const runtime = input.getRuntime();
    if (runtime === null) {
      return;
    }

    event.preventDefault();
    input.clearRuntime();
    cleanupPromise = cleanupAppRuntime(runtime, input.logError).finally(() => {
      canQuit = true;
      input.quit();
    });
  };
}

export function makeProcessSignalHandler(input: {
  readonly quit: () => void;
  readonly forceExit: (exitCode: number) => void;
  readonly logSignal?: ShutdownSignalLogger;
}): (signal: ShutdownSignal) => void {
  let isQuitting = false;

  return (signal) => {
    const forced = isQuitting;
    input.logSignal?.(signal, forced);

    if (forced) {
      input.forceExit(exitCodeForSignal(signal));
      return;
    }

    isQuitting = true;
    input.quit();
  };
}

function exitCodeForSignal(signal: ShutdownSignal): number {
  switch (signal) {
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
  }
}
