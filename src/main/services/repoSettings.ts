import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { RepoSettingsSchema } from "../../shared/schemas";
import type { RepoSettings } from "../../shared/types";
import { JsonDecodeError } from "../errors";
import { makeJsonFileStore } from "./jsonFileStore";

export interface RepoSettingsServiceShape {
  readonly read: (repoId: string) => Effect.Effect<RepoSettings, RepoSettingsError>;
  readonly write: (
    repoId: string,
    settings: RepoSettings,
  ) => Effect.Effect<RepoSettings, RepoSettingsError>;
}

export type RepoSettingsError = JsonDecodeError;

export class RepoSettingsService extends Context.Service<
  RepoSettingsService,
  RepoSettingsServiceShape
>()("clawpatch/RepoSettings") {}

export const RepoSettingsServiceLive = (appDataDir: string) =>
  Layer.effect(
    RepoSettingsService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return RepoSettingsService.of(makeLiveService(appDataDir, fs, path));
    }),
  );

function makeLiveService(
  appDataDir: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): RepoSettingsServiceShape {
  const settingsPath = (repoId: string): string =>
    path.join(appDataDir, "repo-settings", `${repoId}.json`);
  const store = makeJsonFileStore({
    name: "repoSettings",
    schema: RepoSettingsSchema,
    fs,
    path,
    normalize: normalizeSettings,
    fallback: defaultRepoSettings,
  });

  return {
    read: (repoId) => store.read(settingsPath(repoId)),
    write: (repoId, settings) => store.write(settingsPath(repoId), settings),
  };
}

export function defaultRepoSettings(): RepoSettings {
  return {
    schemaVersion: 1,
    terminalStartupScript: "",
    worktreeSetupScript: "",
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeSettings(settings: RepoSettings): RepoSettings {
  const defaults = defaultRepoSettings();
  return {
    ...defaults,
    ...settings,
    schemaVersion: 1,
    terminalStartupScript: settings.terminalStartupScript,
    worktreeSetupScript: settings.worktreeSetupScript,
  };
}
