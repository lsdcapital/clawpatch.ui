import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ClawpatchStatusSchema, PatchAttemptSchema } from "../../shared/schemas";
import type {
  FeatureMapItem,
  FeatureMapSnapshot,
  FindingDetail,
  FindingHistoryEntry,
  FindingListItem,
  PatchAttempt,
  ReviewRunSummary,
} from "../../shared/types";
import { FindingNotFoundError, JsonDecodeError } from "../errors";

const RawFindingSchema = Schema.Struct({
  findingId: Schema.String,
  featureId: Schema.String,
  title: Schema.String,
  category: Schema.String,
  severity: Schema.String,
  confidence: Schema.String,
  triage: Schema.optionalKey(Schema.String),
  evidence: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  reasoning: Schema.String,
  reproduction: Schema.NullOr(Schema.String),
  recommendation: Schema.String,
  whyTestsDoNotAlreadyCoverThis: Schema.optionalKey(Schema.NullOr(Schema.String)),
  suggestedRegressionTest: Schema.optionalKey(Schema.NullOr(Schema.String)),
  minimumFixScope: Schema.optionalKey(Schema.NullOr(Schema.String)),
  status: ClawpatchStatusSchema,
  history: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  linkedPatchAttemptIds: Schema.optionalKey(Schema.Array(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

type RawFinding = typeof RawFindingSchema.Type;

export type ClawpatchStateError = FindingNotFoundError | JsonDecodeError;

export interface ClawpatchStateServiceShape {
  readonly detect: (repoPath: string) => Effect.Effect<boolean, ClawpatchStateError>;
  readonly readFeatureMap: (
    repoPath: string,
  ) => Effect.Effect<FeatureMapSnapshot, ClawpatchStateError>;
  readonly readFindingList: (
    repoPath: string,
  ) => Effect.Effect<FindingListItem[], ClawpatchStateError>;
  readonly readFindingDetail: (
    repoPath: string,
    findingId: string,
  ) => Effect.Effect<FindingDetail, ClawpatchStateError>;
}

export class ClawpatchStateService extends Context.Service<
  ClawpatchStateService,
  ClawpatchStateServiceShape
>()("clawpatch/State") {}

export const ClawpatchStateServiceLive = Layer.effect(
  ClawpatchStateService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const readRecords = Effect.fn("clawpatchState.readRecords")(function* (
      repoPath: string,
      directory: string,
    ) {
      const dir = path.join(repoPath, ".clawpatch", directory);
      const names = yield* fs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([])));

      const records: unknown[] = [];
      for (const name of names.toSorted()) {
        if (!name.endsWith(".json")) {
          continue;
        }
        const filePath = path.join(dir, path.basename(name));
        const parsed = yield* fs.readFileString(filePath).pipe(
          Effect.map((raw) => JSON.parse(raw) as unknown),
          Effect.catch(() => Effect.succeed(null)),
        );
        if (parsed !== null) {
          records.push(parsed);
        }
      }
      return records;
    });

    const readRawFindings = Effect.fn("clawpatchState.readRawFindings")(function* (
      repoPath: string,
    ) {
      const records = yield* readRecords(repoPath, "findings");
      return records
        .map(decodeRawFinding)
        .filter((finding): finding is RawFinding => finding !== null)
        .toSorted(
          (a, b) => rankFinding(a) - rankFinding(b) || a.findingId.localeCompare(b.findingId),
        );
    });

    return ClawpatchStateService.of({
      detect: Effect.fn("clawpatchState.detect")(function* (repoPath) {
        const stateDir = path.join(repoPath, ".clawpatch");
        const candidates = [path.join(stateDir, "config.json"), path.join(stateDir, "findings")];
        for (const candidate of candidates) {
          const exists = yield* fs
            .exists(candidate)
            .pipe(Effect.catch(() => Effect.succeed(false)));
          if (exists) {
            return true;
          }
        }
        return false;
      }),
      readFindingList: Effect.fn("clawpatchState.readFindingList")(function* (repoPath) {
        const rawFindings = yield* readRawFindings(repoPath);
        return rawFindings.map(toFindingListItem);
      }),
      readFeatureMap: Effect.fn("clawpatchState.readFeatureMap")(function* (repoPath) {
        const [featureRecords, runRecords, rawFindings] = yield* Effect.all([
          readRecords(repoPath, "features"),
          readRecords(repoPath, "runs"),
          readRawFindings(repoPath),
        ]);
        const findingsById = new Map(rawFindings.map((finding) => [finding.findingId, finding]));
        const features = featureRecords
          .map((feature) => toFeatureMapItem(feature, findingsById))
          .filter((feature): feature is FeatureMapItem => feature !== null)
          .toSorted(rankFeatureMapItem);
        const pendingReviewFeatureIds = features
          .filter((feature) => isPendingReviewStatus(feature.status))
          .map((feature) => feature.featureId);
        const reviewRuns = runRecords
          .map(toReviewRunSummary)
          .filter((run): run is ReviewRunSummary => run !== null)
          .toSorted(compareReviewRunNewestFirst);
        const latestReviewRun = reviewRuns[0] ?? null;
        const latestLimitedReviewRun = reviewRuns.find((run) => run.limit !== null) ?? null;

        return {
          features,
          coverage: {
            totalFeatures: features.length,
            pendingReviewCount: pendingReviewFeatureIds.length,
            pendingReviewFeatureIds,
            latestReviewRun,
            latestLimitedReviewRun,
            hasLimitedReviewRemainder:
              latestLimitedReviewRun !== null && pendingReviewFeatureIds.length > 0,
          },
        };
      }),
      readFindingDetail: Effect.fn("clawpatchState.readFindingDetail")(
        function* (repoPath, findingId) {
          const finding = (yield* readRawFindings(repoPath)).find(
            (item) => item.findingId === findingId,
          );
          if (finding === undefined) {
            return yield* new FindingNotFoundError({ findingId });
          }

          const [features, patches] = yield* Effect.all([
            readRecords(repoPath, "features"),
            readRecords(repoPath, "patches"),
          ]);
          const feature =
            features.find((item) => objectId(item, "featureId") === finding.featureId) ?? null;
          const patchIds = new Set(finding.linkedPatchAttemptIds ?? []);
          const linkedPatches = patches
            .filter((item) => patchIds.has(objectId(item, "patchAttemptId")))
            .map(decodePatchAttempt)
            .filter((patch): patch is PatchAttempt => patch !== null)
            .toSorted((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt));

          return {
            ...toFindingListItem(finding),
            reasoning: finding.reasoning,
            reproduction: finding.reproduction ?? null,
            recommendation: finding.recommendation,
            whyTestsDoNotAlreadyCoverThis: finding.whyTestsDoNotAlreadyCoverThis ?? null,
            suggestedRegressionTest: finding.suggestedRegressionTest ?? null,
            minimumFixScope: finding.minimumFixScope ?? null,
            feature,
            patchAttempts: linkedPatches,
            history: (finding.history ?? []).map(toFindingHistoryEntry),
          };
        },
      ),
    });
  }),
);

function decodeRawFinding(value: unknown): RawFinding | null {
  try {
    return Schema.decodeUnknownSync(RawFindingSchema)(value);
  } catch {
    return null;
  }
}

function decodePatchAttempt(value: unknown): PatchAttempt | null {
  try {
    return Schema.decodeUnknownSync(PatchAttemptSchema)(value);
  } catch {
    return null;
  }
}

function toFindingListItem(finding: RawFinding): FindingListItem {
  return {
    findingId: finding.findingId,
    featureId: finding.featureId,
    title: finding.title,
    category: finding.category,
    severity: finding.severity,
    confidence: finding.confidence,
    triage: finding.triage ?? null,
    status: finding.status,
    evidence: (finding.evidence ?? []).map((item) => ({
      path: valueOrEmpty(item, "path"),
      startLine: nullableNumber(item, "startLine"),
      endLine: nullableNumber(item, "endLine"),
      symbol: nullableString(item, "symbol"),
      quote: nullableString(item, "quote"),
    })),
    linkedPatchAttemptIds: [...(finding.linkedPatchAttemptIds ?? [])],
    createdAt: finding.createdAt,
    updatedAt: finding.updatedAt,
  };
}

function toFindingHistoryEntry(value: unknown): FindingHistoryEntry {
  return {
    runId: nullableString(value, "runId"),
    kind: firstNonEmptyString(stringValue(value, "kind"), "unknown"),
    status: nullableString(value, "status"),
    note: nullableString(value, "note"),
    reasoning: nullableString(value, "reasoning"),
    commands: arrayValue(value, "commands"),
    createdAt: firstNonEmptyString(stringValue(value, "createdAt"), ""),
  };
}

function toFeatureMapItem(
  value: unknown,
  findingsById: ReadonlyMap<string, RawFinding>,
): FeatureMapItem | null {
  const featureId = valueOrEmpty(value, "featureId");
  if (featureId === "") {
    return null;
  }
  const entrypoints = arrayValue(value, "entrypoints")
    .map(toFeatureMapEntrypoint)
    .filter(
      (entrypoint): entrypoint is NonNullable<ReturnType<typeof toFeatureMapEntrypoint>> =>
        entrypoint !== null,
    );
  const ownedFiles = arrayValue(value, "ownedFiles")
    .map(toFeatureMapFileRef)
    .filter((file): file is NonNullable<ReturnType<typeof toFeatureMapFileRef>> => file !== null);
  const contextFiles = arrayValue(value, "contextFiles")
    .map(toFeatureMapFileRef)
    .filter((file): file is NonNullable<ReturnType<typeof toFeatureMapFileRef>> => file !== null);
  const tests = arrayValue(value, "tests")
    .map(toFeatureMapFileRef)
    .filter((file): file is NonNullable<ReturnType<typeof toFeatureMapFileRef>> => file !== null);
  const findingIds = arrayValue(value, "findingIds").filter(
    (findingId): findingId is string => typeof findingId === "string" && findingId.trim() !== "",
  );
  const linkedFindings = findingIds
    .map((findingId) => findingsById.get(findingId))
    .filter((finding): finding is RawFinding => finding !== undefined)
    .map(toFeatureMapFindingSummary);
  return {
    featureId,
    title: firstNonEmptyString(
      stringValue(value, "title"),
      stringValue(value, "summary"),
      stringValue(value, "path"),
      featureId,
    ),
    summary: nullableNonEmptyString(value, "summary"),
    status: firstNonEmptyString(stringValue(value, "status"), "unknown"),
    kind: firstNonEmptyString(stringValue(value, "kind"), "unknown"),
    source: firstNonEmptyString(
      stringValue(value, "source"),
      stringValue(value, "project"),
      "unknown",
    ),
    entrypoints,
    ownedFiles,
    contextFiles,
    tests,
    findingIds,
    linkedFindings,
    ownedFileCount: ownedFiles.length,
    contextFileCount: contextFiles.length,
    testCount: tests.length,
    findingCount: findingIds.length,
    updatedAt: firstNonEmptyString(
      stringValue(value, "updatedAt"),
      stringValue(value, "createdAt"),
      "",
    ),
  };
}

function toFeatureMapFileRef(value: unknown): FeatureMapItem["ownedFiles"][number] | null {
  if (typeof value === "string") {
    return value.trim() === "" ? null : { path: value, reason: null };
  }
  const path = valueOrEmpty(value, "path");
  if (path.trim() === "") {
    return null;
  }
  return { path, reason: nullableNonEmptyString(value, "reason") };
}

function toFeatureMapEntrypoint(value: unknown): FeatureMapItem["entrypoints"][number] | null {
  const path = valueOrEmpty(value, "path");
  if (path.trim() === "") {
    return null;
  }
  return {
    path,
    symbol: nullableNonEmptyString(value, "symbol"),
    route: nullableNonEmptyString(value, "route"),
    command: nullableNonEmptyString(value, "command"),
  };
}

function toFeatureMapFindingSummary(finding: RawFinding): FeatureMapItem["linkedFindings"][number] {
  return {
    findingId: finding.findingId,
    title: finding.title,
    status: finding.status,
    severity: finding.severity,
    confidence: finding.confidence,
  };
}

function toReviewRunSummary(value: unknown): ReviewRunSummary | null {
  const command = stringValue(value, "command");
  const args = arrayValue(value, "args").filter((item): item is string => typeof item === "string");
  if (command !== "review" && !args.includes("review")) {
    return null;
  }
  const runId = valueOrEmpty(value, "runId");
  if (runId === "") {
    return null;
  }

  return {
    runId,
    status: firstNonEmptyString(stringValue(value, "status"), "unknown"),
    startedAt: firstNonEmptyString(stringValue(value, "startedAt"), ""),
    finishedAt: nullableString(value, "finishedAt"),
    limit: reviewLimit(args),
    reviewedFeatureCount: arrayValue(value, "claimedFeatureIds").length,
    args,
  };
}

function reviewLimit(args: readonly string[]): number | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") {
      const parsed = Number(args[index + 1]);
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    }
    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    }
  }
  return null;
}

function compareReviewRunNewestFirst(left: ReviewRunSummary, right: ReviewRunSummary): number {
  return (
    timestamp(right.startedAt) - timestamp(left.startedAt) || right.runId.localeCompare(left.runId)
  );
}

function rankFeatureMapItem(left: FeatureMapItem, right: FeatureMapItem): number {
  return (
    featureStatusRank(left.status) - featureStatusRank(right.status) ||
    left.title.localeCompare(right.title) ||
    left.featureId.localeCompare(right.featureId)
  );
}

function featureStatusRank(status: string): number {
  if (status === "error") {
    return 0;
  }
  if (status === "pending") {
    return 1;
  }
  if (status === "claimed") {
    return 2;
  }
  return 3;
}

function isPendingReviewStatus(status: string): boolean {
  return status === "pending" || status === "error";
}

function rankFinding(finding: RawFinding): number {
  const severity = { critical: 0, high: 1, medium: 2, low: 3 }[finding.severity] ?? 4;
  const status = finding.status === "open" ? 0 : 10;
  return status + severity;
}

function firstNonEmptyString(...values: string[]): string {
  return values.find((value) => value.trim() !== "") ?? "";
}

function objectId(value: unknown, key: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[key] === "string"
  ) {
    return (value as Record<string, string>)[key];
  }
  return "";
}

function valueOrEmpty(value: unknown, key: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[key] === "string"
  ) {
    return (value as Record<string, string>)[key];
  }
  return "";
}

function stringValue(value: unknown, key: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[key] === "string"
  ) {
    return (value as Record<string, string>)[key];
  }
  return "";
}

function arrayValue(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const raw = (value as Record<string, unknown>)[key];
  return Array.isArray(raw) ? raw : [];
}

function nullableString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}

function nullableNonEmptyString(value: unknown, key: string): string | null {
  const raw = nullableString(value, key);
  return raw !== null && raw.trim() !== "" ? raw : null;
}

function nullableNumber(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" ? raw : null;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
