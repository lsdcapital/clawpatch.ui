import type {
  ClawpatchCommandRequestSchema,
  CommandInterruptResultSchema,
  ClawpatchStatusSchema,
  CommandResultSchema,
  CommandStreamEventSchema,
  EvidenceRefSchema,
  ActiveWorktreeSchema,
  FeatureMapItemSchema,
  FeatureMapSnapshotSchema,
  FindingDetailSchema,
  FindingHistoryEntrySchema,
  FindingListItemSchema,
  GitStatusSummarySchema,
  PatchAttemptSchema,
  PatchCommandRunSchema,
  PatchGitInfoSchema,
  PublishFixResultSchema,
  UiMetadataSchema,
  RepoSnapshotSchema,
  RepoSummarySchema,
  ReviewCoverageSchema,
  ReviewRunSummarySchema,
  TerminalOpenResultSchema,
} from "./schemas";
export { clawpatchStatuses } from "./constants";

export type ClawpatchStatus = typeof ClawpatchStatusSchema.Type;
export type ClawpatchCommandRequest = typeof ClawpatchCommandRequestSchema.Type;
export type CommandInterruptResult = typeof CommandInterruptResultSchema.Type;
export type CommandResult = typeof CommandResultSchema.Type;
export type CommandStreamEvent = typeof CommandStreamEventSchema.Type;
export type PublishFixResult = typeof PublishFixResultSchema.Type;
export type ActiveWorktree = typeof ActiveWorktreeSchema.Type;
export type RepoSummary = typeof RepoSummarySchema.Type;
export type RepoSnapshot = typeof RepoSnapshotSchema.Type;
export type UiMetadata = typeof UiMetadataSchema.Type;
export type EvidenceRef = typeof EvidenceRefSchema.Type;
export type FindingListItem = typeof FindingListItemSchema.Type;
export type FindingHistoryEntry = typeof FindingHistoryEntrySchema.Type;
export type FindingDetail = typeof FindingDetailSchema.Type;
export type PatchCommandRun = typeof PatchCommandRunSchema.Type;
export type PatchGitInfo = typeof PatchGitInfoSchema.Type;
export type PatchAttempt = typeof PatchAttemptSchema.Type;
export type GitStatusSummary = typeof GitStatusSummarySchema.Type;
export type FeatureMapItem = typeof FeatureMapItemSchema.Type;
export type ReviewRunSummary = typeof ReviewRunSummarySchema.Type;
export type ReviewCoverage = typeof ReviewCoverageSchema.Type;
export type FeatureMapSnapshot = typeof FeatureMapSnapshotSchema.Type;
export type TerminalOpenResult = typeof TerminalOpenResultSchema.Type;

export interface Api {
  repo: {
    list: () => Promise<readonly RepoSummary[]>;
    add: (repoPath: string) => Promise<RepoSummary>;
    pickFolder: () => Promise<string | null>;
    refresh: (repoId: string) => Promise<RepoSnapshot>;
  };
  findings: {
    list: (repoId: string) => Promise<readonly FindingListItem[]>;
    get: (repoId: string, findingId: string) => Promise<FindingDetail>;
  };
  features: {
    map: (repoId: string) => Promise<FeatureMapSnapshot>;
  };
  triage: {
    set: (
      repoId: string,
      findingId: string,
      status: ClawpatchStatus,
      note?: string,
    ) => Promise<CommandResult>;
  };
  commands: {
    run: (repoId: string, request: ClawpatchCommandRequest) => Promise<CommandResult>;
    interrupt: (repoId: string, findingId?: string) => Promise<CommandInterruptResult>;
    onStream: (listener: (event: CommandStreamEvent) => void) => () => void;
  };
  git: {
    diff: (repoId: string, findingId?: string) => Promise<string>;
    status: (repoId: string, findingId?: string) => Promise<GitStatusSummary>;
    publishFix: (repoId: string, findingId: string) => Promise<PublishFixResult>;
  };
  terminal: {
    open: (repoId: string, findingId?: string) => Promise<TerminalOpenResult>;
  };
}
