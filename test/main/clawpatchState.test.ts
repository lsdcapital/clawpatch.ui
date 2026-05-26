import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect } from "vitest";
import {
  ClawpatchStateService,
  ClawpatchStateServiceLive,
} from "../../src/main/services/clawpatchState";

const fixtureRepo = resolve("test/fixtures/clawpatch-repo");
const stateLayer = ClawpatchStateServiceLive.pipe(Layer.provide(NodeServices.layer));

describe("clawpatch state reader", () => {
  it.effect("normalizes finding list items without mutating Clawpatch files", () =>
    Effect.gen(function* () {
      const state = yield* ClawpatchStateService;

      const findings = yield* state.readFindingList(fixtureRepo);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        findingId: "fnd-1",
        title: "Null branch can throw",
        severity: "high",
        status: "open",
      });
    }).pipe(Effect.provide(stateLayer)),
  );

  it.effect("loads finding details with feature and linked patches", () =>
    Effect.gen(function* () {
      const state = yield* ClawpatchStateService;

      const detail = yield* state.readFindingDetail(fixtureRepo, "fnd-1");

      expect(detail.reasoning).toContain("null");
      expect(detail.feature).toMatchObject({ featureId: "feat-1" });
      expect(detail.patchAttempts).toHaveLength(1);
      expect(detail.history).toEqual([
        {
          runId: null,
          kind: "triage",
          status: "uncertain",
          note: "needs product call",
          reasoning: null,
          commands: [],
          createdAt: "2026-01-01T01:00:00.000Z",
        },
        {
          runId: "run-2",
          kind: "triage",
          status: "wont-fix",
          note: "accepted risk",
          reasoning: null,
          commands: [],
          createdAt: "2026-01-01T02:00:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(stateLayer)),
  );

  it.effect("reads feature map coverage when run records are missing", () =>
    Effect.gen(function* () {
      const state = yield* ClawpatchStateService;

      const snapshot = yield* state.readFeatureMap(fixtureRepo);

      expect(snapshot.features).toHaveLength(1);
      expect(snapshot.features[0]).toMatchObject({
        featureId: "feat-1",
        title: "Example module",
        status: "reviewed",
        source: "fixture",
      });
      expect(snapshot.coverage).toMatchObject({
        totalFeatures: 1,
        pendingReviewCount: 0,
        latestReviewRun: null,
        latestLimitedReviewRun: null,
        hasLimitedReviewRemainder: false,
      });
    }).pipe(Effect.provide(stateLayer)),
  );

  it.effect("detects limited review runs with pending map items", () =>
    Effect.gen(function* () {
      const tempRepo = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "clawpatch-fixture-")));
      yield* Effect.promise(() => cp(fixtureRepo, tempRepo, { recursive: true }));
      try {
        yield* Effect.promise(() =>
          mkdir(join(tempRepo, ".clawpatch", "features"), { recursive: true }),
        );
        yield* Effect.promise(() =>
          mkdir(join(tempRepo, ".clawpatch", "runs"), { recursive: true }),
        );
        yield* Effect.promise(() =>
          writeFile(
            join(tempRepo, ".clawpatch", "features", "feat-pending.json"),
            JSON.stringify(
              {
                featureId: "feat-pending",
                title: "Pending checkout flow",
                summary: "Reviews checkout submission and confirmation UI.",
                kind: "ui-flow",
                source: "agent",
                status: "pending",
                entrypoints: [
                  {
                    path: "src/checkout.tsx",
                    symbol: "CheckoutPage",
                    route: "/checkout",
                    command: null,
                  },
                ],
                ownedFiles: [{ path: "src/checkout.tsx" }],
                contextFiles: [{ path: "src/api.ts" }],
                tests: [{ path: "src/checkout.test.tsx" }],
                findingIds: [],
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
              null,
              2,
            ),
            "utf8",
          ),
        );
        yield* Effect.promise(() =>
          writeFile(
            join(tempRepo, ".clawpatch", "findings", "fnd-2.json"),
            JSON.stringify(
              {
                findingId: "fnd-2",
                featureId: "feat-error",
                title: "Billing worker drops retry errors",
                category: "bug",
                severity: "medium",
                confidence: "high",
                evidence: [],
                reasoning: "Retry errors can be dropped.",
                reproduction: null,
                recommendation: "Preserve the retry error.",
                status: "open",
                history: [],
                linkedPatchAttemptIds: [],
                createdAt: "2026-01-03T00:00:00.000Z",
                updatedAt: "2026-01-03T00:00:00.000Z",
              },
              null,
              2,
            ),
            "utf8",
          ),
        );
        yield* Effect.promise(() =>
          writeFile(
            join(tempRepo, ".clawpatch", "features", "feat-error.json"),
            JSON.stringify(
              {
                featureId: "feat-error",
                summary: "Errored billing worker",
                kind: "job",
                source: "heuristic",
                status: "error",
                entrypoints: [],
                ownedFiles: [],
                contextFiles: [],
                tests: [],
                findingIds: ["fnd-2"],
                updatedAt: "2026-01-03T00:00:00.000Z",
              },
              null,
              2,
            ),
            "utf8",
          ),
        );
        yield* Effect.promise(() =>
          writeFile(
            join(tempRepo, ".clawpatch", "runs", "run-limited.json"),
            JSON.stringify(
              {
                runId: "run-limited",
                command: "review",
                args: ["--json", "--no-color", "--no-input", "review", "--limit", "3"],
                status: "completed",
                startedAt: "2026-01-04T00:00:00.000Z",
                finishedAt: "2026-01-04T00:05:00.000Z",
                claimedFeatureIds: ["feat-1"],
                findingIds: [],
                patchAttemptIds: [],
                errors: [],
              },
              null,
              2,
            ),
            "utf8",
          ),
        );

        const state = yield* ClawpatchStateService;
        const snapshot = yield* state.readFeatureMap(tempRepo);

        expect(snapshot.coverage.pendingReviewFeatureIds).toEqual(["feat-error", "feat-pending"]);
        expect(
          snapshot.features.find((feature) => feature.featureId === "feat-pending"),
        ).toMatchObject({
          summary: "Reviews checkout submission and confirmation UI.",
          entrypoints: [
            {
              path: "src/checkout.tsx",
              symbol: "CheckoutPage",
              route: "/checkout",
              command: null,
            },
          ],
          ownedFiles: [{ path: "src/checkout.tsx", reason: null }],
          contextFiles: [{ path: "src/api.ts", reason: null }],
          tests: [{ path: "src/checkout.test.tsx", reason: null }],
        });
        expect(
          snapshot.features.find((feature) => feature.featureId === "feat-error"),
        ).toMatchObject({
          findingIds: ["fnd-2"],
          linkedFindings: [
            {
              findingId: "fnd-2",
              title: "Billing worker drops retry errors",
              status: "open",
              severity: "medium",
              confidence: "high",
            },
          ],
        });
        expect(snapshot.coverage.latestLimitedReviewRun).toMatchObject({
          runId: "run-limited",
          limit: 3,
          reviewedFeatureCount: 1,
        });
        expect(snapshot.coverage.hasLimitedReviewRemainder).toBe(true);
      } finally {
        yield* Effect.promise(() => rm(tempRepo, { recursive: true, force: true }));
      }
    }).pipe(Effect.provide(stateLayer)),
  );

  it.effect("skips malformed finding records at the schema boundary", () =>
    Effect.gen(function* () {
      const tempRepo = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "clawpatch-fixture-")));
      yield* Effect.promise(() => cp(fixtureRepo, tempRepo, { recursive: true }));
      try {
        yield* Effect.promise(() =>
          mkdir(join(tempRepo, ".clawpatch", "findings"), { recursive: true }),
        );
        yield* Effect.promise(() =>
          writeFile(
            join(tempRepo, ".clawpatch", "findings", "malformed.json"),
            JSON.stringify({ findingId: "bad", title: "missing required fields" }),
            "utf8",
          ),
        );

        const state = yield* ClawpatchStateService;
        const findings = yield* state.readFindingList(tempRepo);

        expect(findings.map((finding) => finding.findingId)).toEqual(["fnd-1"]);
      } finally {
        yield* Effect.promise(() => rm(tempRepo, { recursive: true, force: true }));
      }
    }).pipe(Effect.provide(stateLayer)),
  );
});
