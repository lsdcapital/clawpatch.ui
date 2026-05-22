import * as Schema from "effect/Schema";
import { clawpatchStatuses } from "./constants";

export const ClawpatchStatusSchema = Schema.Literals(clawpatchStatuses);

export const ClawpatchCommandRequestSchema = Schema.Union([
  Schema.Struct({ command: Schema.Literal("status") }),
  Schema.Struct({ command: Schema.Literal("map") }),
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
  Schema.Struct({
    command: Schema.Literal("fix"),
    findingId: Schema.String,
    status: Schema.optionalKey(ClawpatchStatusSchema),
    note: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ command: Schema.Literal("revalidate"), findingId: Schema.String }),
  Schema.Struct({ command: Schema.Literal("doctor") }),
]);

const CommandResultFields = {
  runId: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  exitCode: Schema.NullOr(Schema.Number),
  durationMs: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  parsedJson: Schema.NullOr(Schema.Unknown),
};

const RelatedCommandResultSchema = Schema.Struct(CommandResultFields);

export const CommandResultSchema = Schema.Struct({
  ...CommandResultFields,
  relatedResults: Schema.optionalKey(Schema.Array(RelatedCommandResultSchema)),
});

export const CommandInterruptResultSchema = Schema.Struct({
  interrupted: Schema.Boolean,
});

export const PublishFixResultSchema = Schema.Struct({
  worktreePath: Schema.String,
  branchName: Schema.String,
  baseBranch: Schema.String,
  commitSha: Schema.String,
  remoteName: Schema.String,
  prUrl: Schema.String,
});

export const GitStatusSummarySchema = Schema.Struct({
  staged: Schema.Number,
  modified: Schema.Number,
  untracked: Schema.Number,
  branch: Schema.NullOr(Schema.String),
});

export const FindingWorkStatusSchema = Schema.Struct({
  findingId: Schema.String,
  worktreePath: Schema.String,
  gitStatus: Schema.NullOr(GitStatusSummarySchema),
  prUrl: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});

const CommandStreamMetadataSchema = {
  runId: Schema.String,
  repoId: Schema.optionalKey(Schema.String),
  findingId: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
};

export const CommandStreamEventSchema = Schema.Union([
  Schema.Struct({
    ...CommandStreamMetadataSchema,
    kind: Schema.Literal("output"),
    stream: Schema.Literals(["stdout", "stderr"]),
    chunk: Schema.String,
  }),
  Schema.Struct({
    ...CommandStreamMetadataSchema,
    kind: Schema.Literal("lifecycle"),
    phase: Schema.String,
    message: Schema.String,
    cwd: Schema.String,
    argv: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
]);

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

export const AppSettingsSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  terminalAppName: Schema.String,
  terminalAppPath: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});

export const RepoSettingsSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  terminalStartupScript: Schema.String,
  worktreeSetupScript: Schema.String,
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

export const PatchCommandRunSchema = Schema.Struct({
  command: Schema.String,
  cwd: Schema.NullOr(Schema.String),
  exitCode: Schema.NullOr(Schema.Number),
  durationMs: Schema.NullOr(Schema.Number),
  stdout: Schema.String,
  stderr: Schema.String,
});

export const PatchGitInfoSchema = Schema.Struct({
  baseSha: Schema.NullOr(Schema.String),
  commitSha: Schema.NullOr(Schema.String),
  branchName: Schema.NullOr(Schema.String),
  prUrl: Schema.NullOr(Schema.String),
});

export const PatchAttemptSchema = Schema.Struct({
  patchAttemptId: Schema.String,
  findingIds: Schema.Array(Schema.String),
  featureIds: Schema.Array(Schema.String),
  status: Schema.String,
  plan: Schema.NullOr(Schema.String),
  filesChanged: Schema.Array(Schema.String),
  commandsRun: Schema.Array(PatchCommandRunSchema),
  testResults: Schema.Array(PatchCommandRunSchema),
  git: PatchGitInfoSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
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
  patchAttempts: Schema.Array(PatchAttemptSchema),
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

export const ActiveWorktreeSchema = Schema.Struct({
  findingId: Schema.String,
  path: Schema.String,
});

export const RepoSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  activeWorktreePath: Schema.NullOr(Schema.String),
  activeWorktrees: Schema.Array(ActiveWorktreeSchema),
  hasClawpatch: Schema.Boolean,
  isValid: Schema.Boolean,
  lastError: Schema.NullOr(Schema.String),
  findingCount: Schema.Number,
  openFindingCount: Schema.Number,
  updatedAt: Schema.String,
});

export const RepoSnapshotSchema = Schema.Struct({
  repo: RepoSummarySchema,
  findings: Schema.Array(FindingListItemSchema),
  diff: Schema.String,
  metadata: UiMetadataSchema,
});

export const TerminalOpenResultSchema = Schema.Struct({
  cwd: Schema.String,
});

export const RepoListSchema = Schema.Array(RepoSummarySchema);
export const FindingListSchema = Schema.Array(FindingListItemSchema);
export const FindingWorkStatusListSchema = Schema.Array(FindingWorkStatusSchema);
