import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, describe, expect } from "vitest";
import { UiMetadataService, UiMetadataServiceLive } from "../../src/main/services/uiMetadata";
import type { UiMetadata } from "../../src/shared/types";

const tempDirs: string[] = [];

describe("UiMetadataService", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it.effect("writes metadata under app data", () =>
    Effect.gen(function* () {
      const appData = yield* Effect.promise(() => makeTempDir());
      yield* Effect.gen(function* () {
        const repoPath = yield* Effect.promise(() => makeTempDir());
        const repoId = "repo-1";
        const service = yield* UiMetadataService;

        yield* service.write(repoId, {
          ...defaultMetadata(),
          lastSelectedFindingId: "fnd-1",
        });

        const raw = yield* Effect.promise(() =>
          readFile(join(appData, "ui-metadata", `${repoId}.json`), "utf8"),
        );
        expect(JSON.parse(raw)).toMatchObject({
          schemaVersion: 1,
          lastSelectedFindingId: "fnd-1",
        });
        expect(yield* Effect.promise(() => pathExists(join(repoPath, ".clawpatch", "ui")))).toBe(
          false,
        );
      }).pipe(Effect.provide(uiMetadataTestLayer(appData)));
    }),
  );

  it.effect("returns default metadata when no ui metadata exists", () =>
    Effect.gen(function* () {
      const appData = yield* Effect.promise(() => makeTempDir());
      yield* Effect.gen(function* () {
        const repoPath = yield* Effect.promise(() => makeTempDir());
        const service = yield* UiMetadataService;
        const metadata = yield* service.read("repo-1", repoPath);

        expect(metadata).toMatchObject({
          filters: { severity: null, status: null, search: "" },
          lastSelectedFindingId: null,
        });
      }).pipe(Effect.provide(uiMetadataTestLayer(appData)));
    }),
  );

  it.effect("migrates legacy .clawpatch/ui metadata into app data", () =>
    Effect.gen(function* () {
      const appData = yield* Effect.promise(() => makeTempDir());
      yield* Effect.gen(function* () {
        const repoPath = yield* Effect.promise(() => makeTempDir());
        const repoId = "repo-legacy";
        const legacyPath = join(repoPath, ".clawpatch", "ui", "state.json");
        yield* Effect.promise(() => mkdir(join(repoPath, ".clawpatch", "ui"), { recursive: true }));
        yield* Effect.promise(() =>
          writeFile(
            legacyPath,
            `${JSON.stringify({
              ...defaultMetadata(),
              filters: { severity: "high", status: "open", search: "race" },
              lastSelectedFindingId: "fnd-legacy",
            })}\n`,
            "utf8",
          ),
        );

        const service = yield* UiMetadataService;
        const metadata = yield* service.read(repoId, repoPath);
        const migratedRaw = yield* Effect.promise(() =>
          readFile(join(appData, "ui-metadata", `${repoId}.json`), "utf8"),
        );

        expect(metadata).toMatchObject({
          filters: { severity: "high", status: "open", search: "race" },
          lastSelectedFindingId: "fnd-legacy",
        });
        expect(JSON.parse(migratedRaw)).toMatchObject({
          lastSelectedFindingId: "fnd-legacy",
        });
        expect(yield* Effect.promise(() => pathExists(legacyPath))).toBe(true);
      }).pipe(Effect.provide(uiMetadataTestLayer(appData)));
    }),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawpatch-ui-metadata-"));
  tempDirs.push(dir);
  return dir;
}

function uiMetadataTestLayer(appData: string) {
  return UiMetadataServiceLive(appData).pipe(Layer.provide(NodeServices.layer));
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

async function pathExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}
