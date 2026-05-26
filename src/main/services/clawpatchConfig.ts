import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type { ClawpatchConfig, ClawpatchStateTracking } from "../../shared/types";
import { JsonDecodeError } from "../errors";

const GITIGNORE_BLOCK_START = "# BEGIN Clawpatch state tracking";
const GITIGNORE_BLOCK_END = "# END Clawpatch state tracking";

export interface ClawpatchConfigServiceShape {
  readonly read: (repoPath: string) => Effect.Effect<ClawpatchConfig, ClawpatchConfigError>;
  readonly write: (
    repoPath: string,
    config: ClawpatchConfig,
  ) => Effect.Effect<ClawpatchConfig, ClawpatchConfigError>;
}

export type ClawpatchConfigError = JsonDecodeError;

export class ClawpatchConfigService extends Context.Service<
  ClawpatchConfigService,
  ClawpatchConfigServiceShape
>()("clawpatch/Config") {}

export const ClawpatchConfigServiceLive = Layer.effect(
  ClawpatchConfigService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return ClawpatchConfigService.of(makeLiveService(fs, path));
  }),
);

function makeLiveService(fs: FileSystem.FileSystem, path: Path.Path): ClawpatchConfigServiceShape {
  const configPath = (repoPath: string): string => path.join(repoPath, ".clawpatch", "config.json");
  const gitignorePath = (repoPath: string): string => path.join(repoPath, ".gitignore");

  const readConfigObject = Effect.fn("clawpatchConfig.readConfigObject")(function* (
    filePath: string,
  ) {
    const exists = yield* fs.exists(filePath).pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) {
      return {};
    }

    const raw = yield* fs
      .readFileString(filePath)
      .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: filePath, cause })));
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => new JsonDecodeError({ path: filePath, cause }),
    });
    return isObjectRecord(parsed) ? parsed : {};
  });

  return {
    read: Effect.fn("clawpatchConfig.read")(function* (repoPath) {
      const raw = yield* readConfigObject(configPath(repoPath)).pipe(
        Effect.catch(() => Effect.succeed({})),
      );
      return toSharedConfig(raw);
    }),
    write: Effect.fn("clawpatchConfig.write")(function* (repoPath, config) {
      const filePath = configPath(repoPath);
      const raw = yield* readConfigObject(filePath).pipe(Effect.catch(() => Effect.succeed({})));
      const nextRaw = {
        ...raw,
        schemaVersion: 1,
        stateTracking: normalizeStateTracking(config.stateTracking),
      };
      yield* fs
        .makeDirectory(path.dirname(filePath), { recursive: true })
        .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: filePath, cause })));
      yield* fs
        .writeFileString(filePath, `${JSON.stringify(nextRaw, null, 2)}\n`)
        .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: filePath, cause })));
      yield* writeGitignorePolicy(
        gitignorePath(repoPath),
        normalizeStateTracking(config.stateTracking),
      );
      return toSharedConfig(nextRaw);
    }),
  };

  function writeGitignorePolicy(filePath: string, stateTracking: ClawpatchStateTracking) {
    return Effect.gen(function* () {
      const raw = yield* fs.readFileString(filePath).pipe(Effect.catch(() => Effect.succeed("")));
      const next = replaceManagedBlock(raw, gitignoreBlock(stateTracking));
      yield* fs
        .writeFileString(filePath, next)
        .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: filePath, cause })));
    });
  }
}

function toSharedConfig(raw: Record<string, unknown>): ClawpatchConfig {
  return {
    schemaVersion: 1,
    stateTracking: normalizeStateTracking(raw["stateTracking"]),
  };
}

function normalizeStateTracking(value: unknown): ClawpatchStateTracking {
  return value === "team" || value === "audit" ? value : "local";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replaceManagedBlock(raw: string, block: string): string {
  const normalized = raw.endsWith("\n") || raw === "" ? raw : `${raw}\n`;
  const start = normalized.indexOf(GITIGNORE_BLOCK_START);
  const end = normalized.indexOf(GITIGNORE_BLOCK_END);
  if (start >= 0 && end >= start) {
    const afterEnd = end + GITIGNORE_BLOCK_END.length;
    const trailingNewline = normalized.slice(afterEnd).startsWith("\n") ? 1 : 0;
    const before = normalized.slice(0, start).replace(/\n*$/, "\n");
    const after = normalized.slice(afterEnd + trailingNewline);
    return `${before}${block}\n${after}`.replace(/^\n+/, "");
  }
  return `${normalized}${normalized === "" ? "" : "\n"}${block}\n`;
}

function gitignoreBlock(stateTracking: ClawpatchStateTracking): string {
  return [GITIGNORE_BLOCK_START, ...gitignoreRules(stateTracking), GITIGNORE_BLOCK_END].join("\n");
}

function gitignoreRules(stateTracking: ClawpatchStateTracking): string[] {
  const rules = [".clawpatch/*", "!.clawpatch/", "!.clawpatch/config.json"];
  if (stateTracking === "team" || stateTracking === "audit") {
    rules.push(
      "!.clawpatch/features/",
      "!.clawpatch/features/**",
      "!.clawpatch/findings/",
      "!.clawpatch/findings/**",
    );
  }
  if (stateTracking === "audit") {
    rules.push(
      "!.clawpatch/reports/",
      "!.clawpatch/reports/**",
      "!.clawpatch/patches/",
      "!.clawpatch/patches/**",
    );
  }
  return rules;
}
