import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it } from "@effect/vitest";
import { deepStrictEqual } from "@effect/vitest/utils";
import * as Effect from "effect/Effect";
import { afterEach } from "vitest";
import {
  DEFAULT_WINDOW_BOUNDS,
  WINDOW_STATE_FILE,
  makeWindowStateFile,
  readWindowState,
  resolveWindowState,
  type WindowStateFile,
  type WorkArea,
} from "../../src/main/windowState";

const primaryDisplay: WorkArea = { x: 0, y: 0, width: 1920, height: 1080 };
const tempDirs: string[] = [];

describe("window state", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it.effect(
    "falls back to first-launch maximized defaults when state is missing or malformed",
    () =>
      Effect.gen(function* () {
        const missingDir = yield* Effect.promise(() => makeTempDir());
        const fromMissing = yield* readWindowState(missingDir, [primaryDisplay]);
        deepStrictEqual(fromMissing, {
          bounds: DEFAULT_WINDOW_BOUNDS,
          isMaximized: true,
          isFullScreen: false,
          isFirstLaunch: true,
        });

        const malformedDir = yield* Effect.promise(() => makeTempDir());
        yield* Effect.promise(() =>
          writeFile(join(malformedDir, WINDOW_STATE_FILE), "{not-json", "utf8"),
        );
        const fromMalformed = yield* readWindowState(malformedDir, [primaryDisplay]);
        deepStrictEqual(fromMalformed, {
          bounds: DEFAULT_WINDOW_BOUNDS,
          isMaximized: true,
          isFullScreen: false,
          isFirstLaunch: true,
        });
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("restores valid saved bounds and window flags", () => {
    const savedState = makeSavedState({
      bounds: { x: 120, y: 80, width: 1400, height: 900 },
      isMaximized: false,
      isFullScreen: false,
    });

    deepStrictEqual(resolveWindowState(savedState, [primaryDisplay]), {
      bounds: { x: 120, y: 80, width: 1400, height: 900 },
      isMaximized: false,
      isFullScreen: false,
      isFirstLaunch: false,
    });
  });

  it("rejects off-screen bounds", () => {
    const savedState = makeSavedState({
      bounds: { x: 3000, y: 2000, width: 1280, height: 820 },
      isMaximized: false,
      isFullScreen: false,
    });

    deepStrictEqual(resolveWindowState(savedState, [primaryDisplay]), {
      bounds: DEFAULT_WINDOW_BOUNDS,
      isMaximized: true,
      isFullScreen: false,
      isFirstLaunch: true,
    });
  });

  it("preserves maximized and fullscreen flags without changing normal bounds", () => {
    const bounds = { x: 40, y: 50, width: 1500, height: 920 };
    const savedState = makeWindowStateFile(bounds, true, true, new Date("2026-05-19T00:00:00Z"));

    deepStrictEqual(savedState, {
      schemaVersion: 1,
      bounds,
      isMaximized: true,
      isFullScreen: true,
      updatedAt: "2026-05-19T00:00:00.000Z",
    });
    deepStrictEqual(resolveWindowState(savedState, [primaryDisplay]), {
      bounds,
      isMaximized: true,
      isFullScreen: true,
      isFirstLaunch: false,
    });
  });
});

function makeSavedState(
  overrides: Pick<WindowStateFile, "bounds" | "isMaximized" | "isFullScreen">,
): WindowStateFile {
  return {
    schemaVersion: 1,
    updatedAt: "2026-05-19T00:00:00.000Z",
    ...overrides,
  };
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawpatch-window-state-"));
  tempDirs.push(dir);
  return dir;
}
