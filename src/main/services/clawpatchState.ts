import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ClawpatchStatusSchema } from "../../shared/schemas";
import type { FindingDetail, FindingListItem, GuiMetadata } from "../../shared/types";
import { JsonDecodeError } from "../errors";

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
  updatedAt: Schema.String
});

type RawFinding = typeof RawFindingSchema.Type;

export interface ClawpatchStateServiceShape {
  readonly detect: (repoPath: string) => Effect.Effect<boolean, unknown>;
  readonly readFindingList: (
    repoPath: string,
    metadata: GuiMetadata
  ) => Effect.Effect<FindingListItem[], unknown>;
  readonly readFindingDetail: (
    repoPath: string,
    findingId: string,
    metadata: GuiMetadata
  ) => Effect.Effect<FindingDetail, unknown>;
}

export class ClawpatchStateService extends Context.Service<
  ClawpatchStateService,
  ClawpatchStateServiceShape
>()("clawpatch/State") {}

const liveService: ClawpatchStateServiceShape = {
  detect: Effect.fn("clawpatchState.detect")(function* (repoPath) {
    const stateDir = join(repoPath, ".clawpatch");
    const candidates = [join(stateDir, "config.json"), join(stateDir, "findings")];
    for (const candidate of candidates) {
      const exists = yield* Effect.tryPromise(() => stat(candidate).then(() => true)).pipe(
        Effect.catch(() => Effect.succeed(false))
      );
      if (exists) {
        return true;
      }
    }
    return false;
  }),
  readFindingList: Effect.fn("clawpatchState.readFindingList")(function* (repoPath, metadata) {
    const rawFindings = yield* readRawFindings(repoPath);
    return rawFindings.map((finding) => toFindingListItem(finding, metadata));
  }),
  readFindingDetail: Effect.fn("clawpatchState.readFindingDetail")(function* (
    repoPath,
    findingId,
    metadata
  ) {
    const finding = (yield* readRawFindings(repoPath)).find((item) => item.findingId === findingId);
    if (finding === undefined) {
      return yield* Effect.fail(new Error(`Finding not found: ${findingId}`));
    }

    const [features, patches] = yield* Effect.all([
      readRecords(repoPath, "features"),
      readRecords(repoPath, "patches")
    ]);
    const feature = features.find((item) => objectId(item, "featureId") === finding.featureId) ?? null;
    const patchIds = new Set(finding.linkedPatchAttemptIds ?? []);
    const linkedPatches = patches.filter((item) => patchIds.has(objectId(item, "patchAttemptId")));

    return {
      ...toFindingListItem(finding, metadata),
      reasoning: finding.reasoning,
      reproduction: finding.reproduction ?? null,
      recommendation: finding.recommendation,
      whyTestsDoNotAlreadyCoverThis: finding.whyTestsDoNotAlreadyCoverThis ?? null,
      suggestedRegressionTest: finding.suggestedRegressionTest ?? null,
      minimumFixScope: finding.minimumFixScope ?? null,
      feature,
      patchAttempts: linkedPatches,
      history: [...(finding.history ?? [])]
    };
  })
};

export const ClawpatchStateServiceLive = Layer.succeed(
  ClawpatchStateService,
  ClawpatchStateService.of(liveService)
);

const readRawFindings = Effect.fn("clawpatchState.readRawFindings")(function* (repoPath: string) {
  const records = yield* readRecords(repoPath, "findings");
  return records
    .map(decodeRawFinding)
    .filter((finding): finding is RawFinding => finding !== null)
    .sort((a, b) => rankFinding(a) - rankFinding(b) || a.findingId.localeCompare(b.findingId));
});

const readRecords = Effect.fn("clawpatchState.readRecords")(function* (
  repoPath: string,
  directory: string
) {
  const dir = join(repoPath, ".clawpatch", directory);
  const names = yield* Effect.tryPromise(() => readdir(dir)).pipe(
    Effect.catch(() => Effect.succeed([] as string[]))
  );

  const records: unknown[] = [];
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const path = join(dir, basename(name));
    const parsed = yield* Effect.tryPromise({
      try: async () => JSON.parse(await readFile(path, "utf8")) as unknown,
      catch: (cause) => new JsonDecodeError({ path, cause })
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    if (parsed !== null) {
      records.push(parsed);
    }
  }
  return records;
});

function decodeRawFinding(value: unknown): RawFinding | null {
  try {
    return Schema.decodeUnknownSync(RawFindingSchema)(value);
  } catch {
    return null;
  }
}

function toFindingListItem(finding: RawFinding, metadata: GuiMetadata): FindingListItem {
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
      quote: nullableString(item, "quote")
    })),
    linkedPatchAttemptIds: [...(finding.linkedPatchAttemptIds ?? [])],
    createdAt: finding.createdAt,
    updatedAt: finding.updatedAt,
    localNote: metadata.notes[finding.findingId] ?? null
  };
}

function rankFinding(finding: RawFinding): number {
  const severity = { critical: 0, high: 1, medium: 2, low: 3 }[finding.severity] ?? 4;
  const status = finding.status === "open" ? 0 : 10;
  return status + severity;
}

function objectId(value: unknown, key: string): string {
  if (typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)[key] === "string") {
    return (value as Record<string, string>)[key];
  }
  return "";
}

function valueOrEmpty(value: unknown, key: string): string {
  if (typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)[key] === "string") {
    return (value as Record<string, string>)[key];
  }
  return "";
}

function nullableString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}

function nullableNumber(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" ? raw : null;
}
