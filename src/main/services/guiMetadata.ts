import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { GuiMetadataSchema } from "../../shared/schemas";
import type { GuiMetadata } from "../../shared/types";
import { JsonDecodeError } from "../errors";

export interface GuiMetadataServiceShape {
  readonly read: (repoPath: string) => Effect.Effect<GuiMetadata, unknown>;
  readonly write: (repoPath: string, metadata: GuiMetadata) => Effect.Effect<GuiMetadata, unknown>;
  readonly setNote: (
    repoPath: string,
    findingId: string,
    note: string
  ) => Effect.Effect<GuiMetadata, unknown>;
}

export class GuiMetadataService extends Context.Service<
  GuiMetadataService,
  GuiMetadataServiceShape
>()("clawpatch/GuiMetadata") {}

const liveService: GuiMetadataServiceShape = {
  read: Effect.fn("guiMetadata.read")(function* (repoPath) {
    const path = metadataPath(repoPath);
    const raw = yield* Effect.tryPromise(() => readFile(path, "utf8")).pipe(
      Effect.catch(() => Effect.succeed(null))
    );
    if (raw === null) {
      return defaultMetadata();
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => cause
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    if (parsed === null) {
      return defaultMetadata();
    }

    const decoded = yield* Schema.decodeUnknownEffect(GuiMetadataSchema)(parsed).pipe(
      Effect.catch(() => Effect.succeed(defaultMetadata()))
    );
    return normalizeMetadata(decoded);
  }),
  write: Effect.fn("guiMetadata.write")(function* (repoPath, metadata) {
    const next = { ...metadata, schemaVersion: 1 as const, updatedAt: new Date().toISOString() };
    yield* Effect.tryPromise({
      try: () => mkdir(join(repoPath, ".clawpatch", "gui"), { recursive: true }),
      catch: (cause) => new JsonDecodeError({ path: metadataPath(repoPath), cause })
    });
    yield* Effect.tryPromise({
      try: () => writeFile(metadataPath(repoPath), `${JSON.stringify(next, null, 2)}\n`, "utf8"),
      catch: (cause) => new JsonDecodeError({ path: metadataPath(repoPath), cause })
    });
    return next;
  }),
  setNote: Effect.fn("guiMetadata.setNote")(function* (repoPath, findingId, note) {
    const metadata = yield* liveService.read(repoPath);
    const nextNotes = { ...metadata.notes };
    if (note.trim() === "") {
      delete nextNotes[findingId];
    } else {
      nextNotes[findingId] = note;
    }
    return yield* liveService.write(repoPath, {
      ...metadata,
      notes: nextNotes,
      lastSelectedFindingId: findingId
    });
  })
};

export const GuiMetadataServiceLive = Layer.succeed(
  GuiMetadataService,
  GuiMetadataService.of(liveService)
);

function metadataPath(repoPath: string): string {
  return join(repoPath, ".clawpatch", "gui", "state.json");
}

function normalizeMetadata(metadata: GuiMetadata): GuiMetadata {
  return {
    ...defaultMetadata(),
    ...metadata,
    filters: { ...defaultMetadata().filters, ...metadata.filters },
    notes: metadata.notes ?? {},
    schemaVersion: 1
  };
}

function defaultMetadata(): GuiMetadata {
  return {
    schemaVersion: 1,
    filters: {
      severity: null,
      status: null,
      search: ""
    },
    notes: {},
    lastSelectedFindingId: null,
    updatedAt: new Date(0).toISOString()
  };
}
