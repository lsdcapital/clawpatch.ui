import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";
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

  it("falls back to first-launch maximized defaults when state is missing or malformed", async () => {
    const missingDir = await makeTempDir();
    await expect(runEffect(readWindowState(missingDir, [primaryDisplay]))).resolves.toEqual({
      bounds: DEFAULT_WINDOW_BOUNDS,
      isMaximized: true,
      isFullScreen: false,
      isFirstLaunch: true,
    });

    const malformedDir = await makeTempDir();
    await writeFile(join(malformedDir, WINDOW_STATE_FILE), "{not-json", "utf8");
    await expect(runEffect(readWindowState(malformedDir, [primaryDisplay]))).resolves.toEqual({
      bounds: DEFAULT_WINDOW_BOUNDS,
      isMaximized: true,
      isFullScreen: false,
      isFirstLaunch: true,
    });
  });

  it("restores valid saved bounds and window flags", () => {
    const savedState = makeSavedState({
      bounds: { x: 120, y: 80, width: 1400, height: 900 },
      isMaximized: false,
      isFullScreen: false,
    });

    expect(resolveWindowState(savedState, [primaryDisplay])).toEqual({
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

    expect(resolveWindowState(savedState, [primaryDisplay])).toEqual({
      bounds: DEFAULT_WINDOW_BOUNDS,
      isMaximized: true,
      isFullScreen: false,
      isFirstLaunch: true,
    });
  });

  it("preserves maximized and fullscreen flags without changing normal bounds", () => {
    const bounds = { x: 40, y: 50, width: 1500, height: 920 };
    const savedState = makeWindowStateFile(bounds, true, true, new Date("2026-05-19T00:00:00Z"));

    expect(savedState).toEqual({
      schemaVersion: 1,
      bounds,
      isMaximized: true,
      isFullScreen: true,
      updatedAt: "2026-05-19T00:00:00.000Z",
    });
    expect(resolveWindowState(savedState, [primaryDisplay])).toEqual({
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

function runEffect<A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
}
