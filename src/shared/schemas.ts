import * as Schema from "effect/Schema";
import { clawpatchStatuses } from "./constants";

export const ClawpatchStatusSchema = Schema.Literals(clawpatchStatuses);

export const ClawpatchCommandRequestSchema = Schema.Union([
  Schema.Struct({ command: Schema.Literal("status") }),
  Schema.Struct({ command: Schema.Literal("map") }),
  Schema.Struct({ command: Schema.Literal("report") }),
  Schema.Struct({
    command: Schema.Literal("review"),
    featureId: Schema.optionalKey(Schema.String),
    limit: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({
    command: Schema.Literal("triage"),
    findingId: Schema.String,
    status: ClawpatchStatusSchema,
    note: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ command: Schema.Literal("fix"), findingId: Schema.String }),
  Schema.Struct({ command: Schema.Literal("revalidate"), findingId: Schema.String }),
  Schema.Struct({ command: Schema.Literal("doctor") }),
]);

export const CommandResultSchema = Schema.Struct({
  runId: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  exitCode: Schema.NullOr(Schema.Number),
  durationMs: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  parsedJson: Schema.NullOr(Schema.Unknown),
});

export const CommandInterruptResultSchema = Schema.Struct({
  interrupted: Schema.Boolean,
});

export const CommandStreamEventSchema = Schema.Struct({
  runId: Schema.String,
  stream: Schema.Literals(["stdout", "stderr"]),
  chunk: Schema.String,
});

export const UiMetadataSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  filters: Schema.Struct({
    severity: Schema.NullOr(Schema.String),
    status: Schema.NullOr(ClawpatchStatusSchema),
    search: Schema.String,
  }),
  lastSelectedFindingId: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});

export const EvidenceRefSchema = Schema.Struct({
  path: Schema.String,
  startLine: Schema.NullOr(Schema.Number),
  endLine: Schema.NullOr(Schema.Number),
  symbol: Schema.NullOr(Schema.String),
  quote: Schema.NullOr(Schema.String),
});

export const FindingListItemSchema = Schema.Struct({
  findingId: Schema.String,
  featureId: Schema.String,
  title: Schema.String,
  category: Schema.String,
  severity: Schema.String,
  confidence: Schema.String,
  triage: Schema.NullOr(Schema.String),
  status: ClawpatchStatusSchema,
  evidence: Schema.Array(EvidenceRefSchema),
  linkedPatchAttemptIds: Schema.Array(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const FindingHistoryEntrySchema = Schema.Struct({
  runId: Schema.NullOr(Schema.String),
  kind: Schema.String,
  status: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
  reasoning: Schema.NullOr(Schema.String),
  commands: Schema.Array(Schema.Unknown),
  createdAt: Schema.String,
});

export const FindingDetailSchema = Schema.Struct({
  ...FindingListItemSchema.fields,
  reasoning: Schema.String,
  reproduction: Schema.NullOr(Schema.String),
  recommendation: Schema.String,
  whyTestsDoNotAlreadyCoverThis: Schema.NullOr(Schema.String),
  suggestedRegressionTest: Schema.NullOr(Schema.String),
  minimumFixScope: Schema.NullOr(Schema.String),
  feature: Schema.NullOr(Schema.Unknown),
  patchAttempts: Schema.Array(Schema.Unknown),
  history: Schema.Array(FindingHistoryEntrySchema),
});

export const FeatureMapItemSchema = Schema.Struct({
  featureId: Schema.String,
  title: Schema.String,
  status: Schema.String,
  kind: Schema.String,
  source: Schema.String,
  ownedFileCount: Schema.Number,
  contextFileCount: Schema.Number,
  testCount: Schema.Number,
  findingCount: Schema.Number,
  updatedAt: Schema.String,
});

export const ReviewRunSummarySchema = Schema.Struct({
  runId: Schema.String,
  status: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  limit: Schema.NullOr(Schema.Number),
  reviewedFeatureCount: Schema.Number,
  args: Schema.Array(Schema.String),
});

export const ReviewCoverageSchema = Schema.Struct({
  totalFeatures: Schema.Number,
  pendingReviewCount: Schema.Number,
  pendingReviewFeatureIds: Schema.Array(Schema.String),
  latestReviewRun: Schema.NullOr(ReviewRunSummarySchema),
  latestLimitedReviewRun: Schema.NullOr(ReviewRunSummarySchema),
  hasLimitedReviewRemainder: Schema.Boolean,
});

export const FeatureMapSnapshotSchema = Schema.Struct({
  features: Schema.Array(FeatureMapItemSchema),
  coverage: ReviewCoverageSchema,
});

export const RepoSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  hasClawpatch: Schema.Boolean,
  isValid: Schema.Boolean,
  lastError: Schema.NullOr(Schema.String),
  findingCount: Schema.Number,
  openFindingCount: Schema.Number,
  updatedAt: Schema.String,
});

export const RepoSnapshotSchema = Schema.Struct({
  repo: RepoSummarySchema,
  status: Schema.NullOr(Schema.Unknown),
  findings: Schema.Array(FindingListItemSchema),
  diff: Schema.String,
  metadata: UiMetadataSchema,
});

export const RepoListSchema = Schema.Array(RepoSummarySchema);
export const FindingListSchema = Schema.Array(FindingListItemSchema);
