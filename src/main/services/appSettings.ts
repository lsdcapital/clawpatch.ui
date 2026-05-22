import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { AppSettingsSchema } from "../../shared/schemas";
import type { AppSettings } from "../../shared/types";
import { catchAll } from "../effectCompat";
import { JsonDecodeError } from "../errors";

type SettingsReadResult =
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "valid"; readonly settings: AppSettings };

export interface AppSettingsServiceShape {
  readonly read: () => Effect.Effect<AppSettings, AppSettingsError>;
  readonly write: (settings: AppSettings) => Effect.Effect<AppSettings, AppSettingsError>;
}

export type AppSettingsError = JsonDecodeError;

export class AppSettingsService extends Context.Service<
  AppSettingsService,
  AppSettingsServiceShape
>()("clawpatch/AppSettings") {}

export const AppSettingsServiceLive = (appDataDir: string) =>
  Layer.effect(
    AppSettingsService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return AppSettingsService.of(makeLiveService(appDataDir, fs, path));
    }),
  );

function makeLiveService(
  appDataDir: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): AppSettingsServiceShape {
  const settingsPath = path.join(appDataDir, "app-settings.json");

  const readSettingsFile = Effect.fn("appSettings.readSettingsFile")(function* () {
    const exists = yield* fs.exists(settingsPath).pipe(catchAll(() => Effect.succeed(false)));
    if (!exists) {
      return { status: "missing" } satisfies SettingsReadResult;
    }

    const raw = yield* fs.readFileString(settingsPath).pipe(catchAll(() => Effect.succeed(null)));
    if (raw === null) {
      return { status: "invalid" } satisfies SettingsReadResult;
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => cause,
    }).pipe(catchAll(() => Effect.succeed(undefined)));
    if (parsed === undefined) {
      return { status: "invalid" } satisfies SettingsReadResult;
    }

    return yield* Schema.decodeUnknownEffect(AppSettingsSchema)(parsed).pipe(
      Effect.map(
        (settings): SettingsReadResult => ({
          status: "valid",
          settings: normalizeSettings(settings),
        }),
      ),
      catchAll(() => Effect.succeed({ status: "invalid" } satisfies SettingsReadResult)),
    );
  });

  const writeSettingsFile = Effect.fn("appSettings.writeSettingsFile")(function* (
    settings: AppSettings,
  ) {
    yield* fs
      .makeDirectory(path.dirname(settingsPath), { recursive: true })
      .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: settingsPath, cause })));
    yield* fs
      .writeFileString(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
      .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: settingsPath, cause })));
  });

  return {
    read: Effect.fn("appSettings.read")(function* () {
      const result = yield* readSettingsFile();
      return result.status === "valid" ? result.settings : defaultAppSettings();
    }),
    write: Effect.fn("appSettings.write")(function* (settings) {
      const next = normalizeSettings({
        ...settings,
        schemaVersion: 1 as const,
        updatedAt: new Date().toISOString(),
      });
      yield* writeSettingsFile(next);
      return next;
    }),
  };
}

export function defaultAppSettings(): AppSettings {
  return {
    schemaVersion: 1,
    terminalAppName: "Terminal",
    terminalAppPath: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const defaults = defaultAppSettings();
  const terminalAppPath = settings.terminalAppPath?.trim() ?? "";
  return {
    ...defaults,
    ...settings,
    schemaVersion: 1,
    terminalAppName: settings.terminalAppName.trim() || defaults.terminalAppName,
    terminalAppPath: terminalAppPath === "" ? null : terminalAppPath,
  };
}
