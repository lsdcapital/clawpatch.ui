import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect } from "vitest";
import { UiMetadataService, UiMetadataServiceLive } from "../../src/main/services/uiMetadata";
import type { UiMetadata } from "../../src/shared/types";

const tempDirs: string[] = [];

describe("UiMetadataService", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it.effect("writes metadata under .clawpatch/ui", () =>
    Effect.gen(function* () {
      const repoPath = yield* Effect.promise(() => makeTempDir());
      const service = yield* UiMetadataService;

      yield* service.write(repoPath, {
        ...defaultMetadata(),
        lastSelectedFindingId: "fnd-1",
      });

      const raw = yield* Effect.promise(() =>
        readFile(join(repoPath, ".clawpatch", "ui", "state.json"), "utf8"),
      );
      expect(JSON.parse(raw)).toMatchObject({
        schemaVersion: 1,
        lastSelectedFindingId: "fnd-1",
      });
    }).pipe(Effect.provide(UiMetadataServiceLive)),
  );

  it.effect("returns default metadata when no ui metadata exists", () =>
    Effect.gen(function* () {
      const repoPath = yield* Effect.promise(() => makeTempDir());
      const service = yield* UiMetadataService;
      const metadata = yield* service.read(repoPath);

      expect(metadata).toMatchObject({
        filters: { severity: null, status: null, search: "" },
        lastSelectedFindingId: null,
      });
    }).pipe(Effect.provide(UiMetadataServiceLive)),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawpatch-ui-metadata-"));
  tempDirs.push(dir);
  return dir;
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
    updatedAt: "2026-05-19T00:00:00.000Z",
  };
}
