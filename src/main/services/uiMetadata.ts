import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { UiMetadataSchema } from "../../shared/schemas";
import type { UiMetadata } from "../../shared/types";
import { JsonDecodeError } from "../errors";

type MetadataReadResult =
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "valid"; readonly metadata: UiMetadata };

export interface UiMetadataServiceShape {
  readonly read: (repoId: string, repoPath: string) => Effect.Effect<UiMetadata, unknown>;
  readonly write: (repoId: string, metadata: UiMetadata) => Effect.Effect<UiMetadata, unknown>;
}

export class UiMetadataService extends Context.Service<UiMetadataService, UiMetadataServiceShape>()(
  "clawpatch/UiMetadata",
) {}

export const UiMetadataServiceLive = (appDataDir: string) =>
  Layer.succeed(UiMetadataService, UiMetadataService.of(makeLiveService(appDataDir)));

function makeLiveService(appDataDir: string): UiMetadataServiceShape {
  return {
    read: Effect.fn("uiMetadata.read")(function* (repoId, repoPath) {
      const activePath = metadataPath(appDataDir, repoId);
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
      yield* writeMetadataFile(metadataPath(appDataDir, repoId), next);
      return next;
    }),
  };
}

const readMetadataFile = Effect.fn("uiMetadata.readMetadataFile")(function* (path: string) {
  const rawResult = yield* Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => cause,
  }).pipe(
    Effect.map((raw) => ({ status: "read" as const, raw })),
    Effect.catch((cause) =>
      Effect.succeed(isNotFoundError(cause) ? missingMetadata() : invalidMetadata()),
    ),
  );
  if (rawResult.status !== "read") {
    return rawResult;
  }

  const parsed = yield* Effect.try({
    try: () => JSON.parse(rawResult.raw) as unknown,
    catch: (cause) => cause,
  }).pipe(Effect.catch(() => Effect.succeed(undefined)));
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
    Effect.catch(() => Effect.succeed(invalidMetadata())),
  );
});

const writeMetadataFile = Effect.fn("uiMetadata.writeMetadataFile")(function* (
  path: string,
  metadata: UiMetadata,
) {
  yield* Effect.tryPromise({
    try: () => mkdir(dirname(path), { recursive: true }),
    catch: (cause) => new JsonDecodeError({ path, cause }),
  });
  yield* Effect.tryPromise({
    try: () => writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
    catch: (cause) => new JsonDecodeError({ path, cause }),
  });
});

function metadataPath(appDataDir: string, repoId: string): string {
  return join(appDataDir, "ui-metadata", `${repoId}.json`);
}

function legacyMetadataPath(repoPath: string): string {
  return join(repoPath, ".clawpatch", "ui", "state.json");
}

function missingMetadata(): MetadataReadResult {
  return { status: "missing" };
}

function invalidMetadata(): MetadataReadResult {
  return { status: "invalid" };
}

function isNotFoundError(cause: unknown): boolean {
  return (
    cause !== null && typeof cause === "object" && "code" in cause && cause["code"] === "ENOENT"
  );
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
