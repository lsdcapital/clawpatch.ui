import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { AppSettingsSchema } from "../../shared/schemas";
import { defaultAiAssistantCommand } from "../../shared/constants";
import type { AppSettings } from "../../shared/types";
import { JsonDecodeError } from "../errors";
import { makeJsonFileStore } from "./jsonFileStore";

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
  const store = makeJsonFileStore({
    name: "appSettings",
    schema: AppSettingsSchema,
    fs,
    path,
    normalize: normalizeSettings,
    fallback: defaultAppSettings,
  });

  return {
    read: () => store.read(settingsPath),
    write: (settings) => store.write(settingsPath, settings),
  };
}

export function defaultAppSettings(): AppSettings {
  return {
    schemaVersion: 1,
    terminalAppName: "Terminal",
    terminalAppPath: null,
    aiAssistantCommand: defaultAiAssistantCommand,
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
    aiAssistantCommand:
      settings.aiAssistantCommand?.trim() === ""
        ? defaults.aiAssistantCommand
        : (settings.aiAssistantCommand ?? defaults.aiAssistantCommand),
  };
}
