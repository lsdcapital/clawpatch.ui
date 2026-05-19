import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect } from "vitest";
import { ClawpatchStateService, ClawpatchStateServiceLive } from "../../src/main/services/clawpatchState";
import { GuiMetadataService, GuiMetadataServiceLive } from "../../src/main/services/guiMetadata";

const fixtureRepo = resolve("test/fixtures/clawpatch-repo");
const stateLayer = Layer.mergeAll(ClawpatchStateServiceLive, GuiMetadataServiceLive);

describe("clawpatch state reader", () => {
  it.effect("normalizes finding list items without mutating Clawpatch files", () =>
    Effect.gen(function* () {
      const state = yield* ClawpatchStateService;
      const metadata = yield* GuiMetadataService;

      const findings = yield* state.readFindingList(fixtureRepo, yield* metadata.read(fixtureRepo));

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        findingId: "fnd-1",
        title: "Null branch can throw",
        severity: "high",
        status: "open"
      });
    }).pipe(Effect.provide(stateLayer))
  );

  it.effect("loads finding details with feature and linked patches", () =>
    Effect.gen(function* () {
      const state = yield* ClawpatchStateService;
      const metadata = yield* GuiMetadataService;

      const detail = yield* state.readFindingDetail(
        fixtureRepo,
        "fnd-1",
        yield* metadata.read(fixtureRepo)
      );

      expect(detail.reasoning).toContain("null");
      expect(detail.feature).toMatchObject({ featureId: "feat-1" });
      expect(detail.patchAttempts).toHaveLength(1);
    }).pipe(Effect.provide(stateLayer))
  );

  it.effect("skips malformed finding records at the schema boundary", () =>
    Effect.gen(function* () {
      const tempRepo = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "clawpatch-fixture-")));
      yield* Effect.promise(() => cp(fixtureRepo, tempRepo, { recursive: true }));
      try {
        yield* Effect.promise(() => mkdir(join(tempRepo, ".clawpatch", "findings"), { recursive: true }));
        yield* Effect.promise(() =>
          writeFile(
            join(tempRepo, ".clawpatch", "findings", "malformed.json"),
            JSON.stringify({ findingId: "bad", title: "missing required fields" }),
            "utf8"
          )
        );

        const state = yield* ClawpatchStateService;
        const metadata = yield* GuiMetadataService;
        const findings = yield* state.readFindingList(tempRepo, yield* metadata.read(tempRepo));

        expect(findings.map((finding) => finding.findingId)).toEqual(["fnd-1"]);
      } finally {
        yield* Effect.promise(() => rm(tempRepo, { recursive: true, force: true }));
      }
    }).pipe(Effect.provide(stateLayer))
  );
});
describe("gui metadata", () => {
  it.effect("stores app-only notes under .clawpatch/gui", () =>
    Effect.gen(function* () {
      const tempRepo = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "clawpatch-fixture-")));
      yield* Effect.promise(() => cp(fixtureRepo, tempRepo, { recursive: true }));
      try {
        const metadata = yield* GuiMetadataService;
        const state = yield* ClawpatchStateService;
        const nextMetadata = yield* metadata.setNote(tempRepo, "fnd-1", "check later");

        expect(nextMetadata.notes["fnd-1"]).toBe("check later");
        const findings = yield* state.readFindingList(tempRepo, nextMetadata);
        expect(findings[0].localNote).toBe("check later");
      } finally {
        yield* Effect.promise(() => rm(tempRepo, { recursive: true, force: true }));
      }
    }).pipe(Effect.provide(stateLayer))
  );
});
