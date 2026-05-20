import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import {
  ClawpatchRunner,
  type ClawpatchRunnerShape,
} from "../../src/main/services/clawpatchRunner";
import {
  cleanupAppRuntime,
  makeBeforeQuitHandler,
  type AppRuntimeCleanup,
} from "../../src/main/shutdown";

describe("main shutdown", () => {
  it("interrupts active commands before disposing the runtime", async () => {
    const calls: string[] = [];
    const runtime = makeRuntime({
      interruptAll: () =>
        Effect.sync(() => {
          calls.push("interruptAll");
          return 2;
        }),
      dispose: () => {
        calls.push("dispose");
        return Promise.resolve();
      },
    });

    await cleanupAppRuntime(runtime);

    expect(calls).toEqual(["interruptAll", "dispose"]);
  });

  it("runs before-quit cleanup once and re-quits after cleanup finishes", async () => {
    let resolveDispose: (() => void) | undefined;
    const dispose = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDispose = resolve;
        }),
    );
    const runtime = makeRuntime({
      dispose,
    });
    let currentRuntime: AppRuntimeCleanup<ClawpatchRunner> | null = runtime;
    const quit = vi.fn();
    const clearRuntime = vi.fn(() => {
      currentRuntime = null;
    });
    const handler = makeBeforeQuitHandler({
      getRuntime: () => currentRuntime,
      clearRuntime,
      quit,
    });
    const firstEvent = { preventDefault: vi.fn() };
    const secondEvent = { preventDefault: vi.fn() };

    handler(firstEvent);
    handler(secondEvent);
    await waitUntil(() => resolveDispose !== undefined);

    expect(firstEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(secondEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(clearRuntime).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();

    resolveDispose?.();
    await waitUntil(() => quit.mock.calls.length === 1);

    const finalEvent = { preventDefault: vi.fn() };
    handler(finalEvent);
    expect(finalEvent.preventDefault).not.toHaveBeenCalled();
  });
});

function makeRuntime(options: {
  readonly interruptAll?: ClawpatchRunnerShape["interruptAll"];
  readonly dispose?: () => Promise<void>;
}): AppRuntimeCleanup<ClawpatchRunner> {
  const runner = ClawpatchRunner.of({
    run: () => Effect.die("not implemented"),
    interrupt: () => Effect.succeed({ interrupted: false }),
    interruptAll: options.interruptAll ?? (() => Effect.succeed(0)),
    isRunning: () => Effect.succeed(false),
  });

  return {
    runPromise: <A, E>(effect: Effect.Effect<A, E, ClawpatchRunner>) =>
      Effect.runPromise(
        effect.pipe(Effect.provideService(ClawpatchRunner, runner)) as Effect.Effect<A, never>,
      ),
    dispose: options.dispose ?? (() => Promise.resolve()),
  };
}

async function waitUntil(assertion: () => boolean): Promise<void> {
  const started = Date.now();
  while (!assertion()) {
    if (Date.now() - started > 1000) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
