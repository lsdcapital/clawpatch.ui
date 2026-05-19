import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { UiMetadataSchema } from "../../shared/schemas";
import type { UiMetadata } from "../../shared/types";
import { JsonDecodeError } from "../errors";

export interface UiMetadataServiceShape {
  readonly read: (repoPath: string) => Effect.Effect<UiMetadata, unknown>;
  readonly write: (repoPath: string, metadata: UiMetadata) => Effect.Effect<UiMetadata, unknown>;
}

export class UiMetadataService extends Context.Service<UiMetadataService, UiMetadataServiceShape>()(
  "clawpatch/UiMetadata",
) {}

const liveService: UiMetadataServiceShape = {
  read: Effect.fn("uiMetadata.read")(function* (repoPath) {
    const raw = yield* Effect.tryPromise(() => readFile(metadataPath(repoPath), "utf8")).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (raw === null) {
      return defaultMetadata();
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => cause,
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    if (parsed === null) {
      return defaultMetadata();
    }

    const decoded = yield* Schema.decodeUnknownEffect(UiMetadataSchema)(parsed).pipe(
      Effect.catch(() => Effect.succeed(defaultMetadata())),
    );
    return normalizeMetadata(decoded);
  }),
  write: Effect.fn("uiMetadata.write")(function* (repoPath, metadata) {
    const next = { ...metadata, schemaVersion: 1 as const, updatedAt: new Date().toISOString() };
    yield* Effect.tryPromise({
      try: () => mkdir(join(repoPath, ".clawpatch", "ui"), { recursive: true }),
      catch: (cause) => new JsonDecodeError({ path: metadataPath(repoPath), cause }),
    });
    yield* Effect.tryPromise({
      try: () => writeFile(metadataPath(repoPath), `${JSON.stringify(next, null, 2)}\n`, "utf8"),
      catch: (cause) => new JsonDecodeError({ path: metadataPath(repoPath), cause }),
    });
    return next;
  }),
};

export const UiMetadataServiceLive = Layer.succeed(
  UiMetadataService,
  UiMetadataService.of(liveService),
);

function metadataPath(repoPath: string): string {
  return join(repoPath, ".clawpatch", "ui", "state.json");
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
