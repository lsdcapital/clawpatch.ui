import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { UiMetadataSchema } from "../../shared/schemas";
import type { UiMetadata } from "../../shared/types";
import { catchAll } from "../effectCompat";
import { JsonDecodeError } from "../errors";

type MetadataReadResult =
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "valid"; readonly metadata: UiMetadata };

export interface UiMetadataServiceShape {
  readonly read: (repoId: string, repoPath: string) => Effect.Effect<UiMetadata, UiMetadataError>;
  readonly write: (
    repoId: string,
    metadata: UiMetadata,
  ) => Effect.Effect<UiMetadata, UiMetadataError>;
}

export type UiMetadataError = JsonDecodeError;

export class UiMetadataService extends Context.Service<UiMetadataService, UiMetadataServiceShape>()(
  "clawpatch/UiMetadata",
) {}

export const UiMetadataServiceLive = (appDataDir: string) =>
  Layer.effect(
    UiMetadataService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return UiMetadataService.of(makeLiveService(appDataDir, fs, path));
    }),
  );

function makeLiveService(
  appDataDir: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
): UiMetadataServiceShape {
  const metadataPath = (repoId: string): string =>
    path.join(appDataDir, "ui-metadata", `${repoId}.json`);
  const legacyMetadataPath = (repoPath: string): string =>
    path.join(repoPath, ".clawpatch", "ui", "state.json");

  const readMetadataFile = Effect.fn("uiMetadata.readMetadataFile")(function* (filePath: string) {
    const exists = yield* fs.exists(filePath).pipe(catchAll(() => Effect.succeed(false)));
    if (!exists) {
      return missingMetadata();
    }

    const raw = yield* fs.readFileString(filePath).pipe(catchAll(() => Effect.succeed(null)));
    if (raw === null) {
      return invalidMetadata();
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => cause,
    }).pipe(catchAll(() => Effect.succeed(undefined)));
    if (parsed === undefined) {
      return invalidMetadata();
    }

    return yield* Schema.decodeUnknownEffect(UiMetadataSchema)(parsed).pipe(
      Effect.map(
        (metadata): MetadataReadResult => ({
          status: "valid",
          metadata: normalizeMetadata(metadata),
        }),
      ),
      catchAll(() => Effect.succeed(invalidMetadata())),
    );
  });

  const writeMetadataFile = Effect.fn("uiMetadata.writeMetadataFile")(function* (
    filePath: string,
    metadata: UiMetadata,
  ) {
    yield* fs
      .makeDirectory(path.dirname(filePath), { recursive: true })
      .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: filePath, cause })));
    yield* fs
      .writeFileString(filePath, `${JSON.stringify(metadata, null, 2)}\n`)
      .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: filePath, cause })));
  });

  return {
    read: Effect.fn("uiMetadata.read")(function* (repoId, repoPath) {
      const activePath = metadataPath(repoId);
      const active = yield* readMetadataFile(activePath);
      if (active.status === "valid") {
        return active.metadata;
      }
      if (active.status === "invalid") {
        return defaultMetadata();
      }

      const legacy = yield* readMetadataFile(legacyMetadataPath(repoPath));
      if (legacy.status !== "valid") {
        return defaultMetadata();
      }

      yield* writeMetadataFile(activePath, legacy.metadata);
      return legacy.metadata;
    }),
    write: Effect.fn("uiMetadata.write")(function* (repoId, metadata) {
      const next = { ...metadata, schemaVersion: 1 as const, updatedAt: new Date().toISOString() };
      yield* writeMetadataFile(metadataPath(repoId), next);
      return next;
    }),
  };
}

function missingMetadata(): MetadataReadResult {
  return { status: "missing" };
}

function invalidMetadata(): MetadataReadResult {
  return { status: "invalid" };
}

function normalizeMetadata(metadata: UiMetadata): UiMetadata {
  return {
    ...defaultMetadata(),
    ...metadata,
    filters: { ...defaultMetadata().filters, ...metadata.filters },
    schemaVersion: 1,
  };
}

function defaultMetadata(): UiMetadata {
  return {
    schemaVersion: 1,
    filters: {
      severity: null,
      status: null,
      search: "",
    },
    lastSelectedFindingId: null,
    updatedAt: new Date(0).toISOString(),
  };
}
