import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import { catchAll } from "./effectCompat";

export const WINDOW_STATE_FILE = "window-state.json";
export const DEFAULT_WINDOW_BOUNDS = {
  width: 1280,
  height: 820,
};
export const MIN_WINDOW_WIDTH = 980;
export const MIN_WINDOW_HEIGHT = 680;

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorkArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowStateFile {
  readonly schemaVersion: 1;
  readonly bounds: WindowBounds;
  readonly isMaximized: boolean;
  readonly isFullScreen: boolean;
  readonly updatedAt: string;
}

export interface ResolvedWindowState {
  readonly bounds: Partial<WindowBounds> & Pick<WindowBounds, "width" | "height">;
  readonly isMaximized: boolean;
  readonly isFullScreen: boolean;
  readonly isFirstLaunch: boolean;
}

export function readWindowState(
  userDataPath: string,
  workAreas: readonly WorkArea[],
): Effect.Effect<ResolvedWindowState, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const raw = yield* fs
      .readFileString(path.join(userDataPath, WINDOW_STATE_FILE))
      .pipe(catchAll(() => Effect.succeed(null)));
    if (raw === null) {
      return defaultWindowState();
    }

    const parsed = parseJson(raw);
    return resolveWindowState(parsed, workAreas);
  });
}

export function writeWindowState(
  userDataPath: string,
  state: WindowStateFile,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(userDataPath, { recursive: true });
    yield* fs.writeFileString(
      path.join(userDataPath, WINDOW_STATE_FILE),
      `${JSON.stringify(state, null, 2)}\n`,
    );
  });
}

export function makeWindowStateFile(
  bounds: WindowBounds,
  isMaximized: boolean,
  isFullScreen: boolean,
  now = new Date(),
): WindowStateFile {
  return {
    schemaVersion: 1,
    bounds: normalizeBounds(bounds),
    isMaximized,
    isFullScreen,
    updatedAt: now.toISOString(),
  };
}

export function resolveWindowState(
  raw: unknown,
  workAreas: readonly WorkArea[],
): ResolvedWindowState {
  const decoded = decodeWindowState(raw);
  if (decoded === null || !isBoundsOnScreen(decoded.bounds, workAreas)) {
    return defaultWindowState();
  }

  return {
    bounds: decoded.bounds,
    isMaximized: decoded.isMaximized,
    isFullScreen: decoded.isFullScreen,
    isFirstLaunch: false,
  };
}

export function defaultWindowState(): ResolvedWindowState {
  return {
    bounds: DEFAULT_WINDOW_BOUNDS,
    isMaximized: true,
    isFullScreen: false,
    isFirstLaunch: true,
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function decodeWindowState(raw: unknown): WindowStateFile | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (
    record["schemaVersion"] !== 1 ||
    typeof record["isMaximized"] !== "boolean" ||
    typeof record["isFullScreen"] !== "boolean" ||
    typeof record["updatedAt"] !== "string"
  ) {
    return null;
  }

  const bounds = decodeBounds(record["bounds"]);
  if (bounds === null) {
    return null;
  }

  return {
    schemaVersion: 1,
    bounds,
    isMaximized: record["isMaximized"],
    isFullScreen: record["isFullScreen"],
    updatedAt: record["updatedAt"],
  };
}

function decodeBounds(raw: unknown): WindowBounds | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const x = decodeFiniteNumber(record["x"]);
  const y = decodeFiniteNumber(record["y"]);
  const width = decodeFiniteNumber(record["width"]);
  const height = decodeFiniteNumber(record["height"]);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  if (width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT) {
    return null;
  }
  return normalizeBounds({ x, y, width, height });
}

function decodeFiniteNumber(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function normalizeBounds(bounds: WindowBounds): WindowBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
}

function isBoundsOnScreen(bounds: WindowBounds, workAreas: readonly WorkArea[]): boolean {
  if (workAreas.length === 0) {
    return true;
  }
  return workAreas.some((workArea) => rectanglesIntersect(bounds, workArea));
}

function rectanglesIntersect(first: WindowBounds, second: WorkArea): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}
