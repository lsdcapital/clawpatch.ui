import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { RepoSettingsSchema } from "../../shared/schemas";
import type { RepoSettings } from "../../shared/types";
import { catchAll } from "../effectCompat";
import { JsonDecodeError } from "../errors";

type SettingsReadResult =
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "valid"; readonly settings: RepoSettings };

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

  const readSettingsFile = Effect.fn("repoSettings.readSettingsFile")(function* (filePath: string) {
    const exists = yield* fs.exists(filePath).pipe(catchAll(() => Effect.succeed(false)));
    if (!exists) {
      return { status: "missing" } satisfies SettingsReadResult;
    }

    const raw = yield* fs.readFileString(filePath).pipe(catchAll(() => Effect.succeed(null)));
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

    return yield* Schema.decodeUnknownEffect(RepoSettingsSchema)(parsed).pipe(
      Effect.map(
        (settings): SettingsReadResult => ({
          status: "valid",
          settings: normalizeSettings(settings),
        }),
      ),
      catchAll(() => Effect.succeed({ status: "invalid" } satisfies SettingsReadResult)),
    );
  });

  const writeSettingsFile = Effect.fn("repoSettings.writeSettingsFile")(function* (
    filePath: string,
    settings: RepoSettings,
  ) {
    yield* fs
      .makeDirectory(path.dirname(filePath), { recursive: true })
      .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: filePath, cause })));
    yield* fs
      .writeFileString(filePath, `${JSON.stringify(settings, null, 2)}\n`)
      .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: filePath, cause })));
  });

  return {
    read: Effect.fn("repoSettings.read")(function* (repoId) {
      const result = yield* readSettingsFile(settingsPath(repoId));
      return result.status === "valid" ? result.settings : defaultRepoSettings();
    }),
    write: Effect.fn("repoSettings.write")(function* (repoId, settings) {
      const next = normalizeSettings({
        ...settings,
        schemaVersion: 1 as const,
        updatedAt: new Date().toISOString(),
      });
      yield* writeSettingsFile(settingsPath(repoId), next);
      return next;
    }),
  };
}

export function defaultRepoSettings(): RepoSettings {
  return {
    schemaVersion: 1,
    terminalAppName: "Terminal",
    terminalStartupScript: "",
    worktreeSetupScript: "",
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeSettings(settings: RepoSettings): RepoSettings {
  const defaults = defaultRepoSettings();
  const terminalAppName = settings.terminalAppName.trim() || defaults.terminalAppName;
  return {
    ...defaults,
    ...settings,
    schemaVersion: 1,
    terminalAppName,
    terminalStartupScript: settings.terminalStartupScript,
    worktreeSetupScript: settings.worktreeSetupScript,
  };
}
