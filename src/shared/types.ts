import type {
  ClawpatchCommandRequestSchema,
  ClawpatchStatusSchema,
  CommandResultSchema,
  CommandStreamEventSchema,
  EvidenceRefSchema,
  FeatureMapItemSchema,
  FeatureMapSnapshotSchema,
  FindingDetailSchema,
  FindingListItemSchema,
  GuiMetadataSchema,
  RepoSnapshotSchema,
  RepoSummarySchema,
  ReviewCoverageSchema,
  ReviewRunSummarySchema
} from "./schemas";
export { clawpatchStatuses } from "./constants";

export type ClawpatchStatus = typeof ClawpatchStatusSchema.Type;
export type ClawpatchCommandRequest = typeof ClawpatchCommandRequestSchema.Type;
export type CommandResult = typeof CommandResultSchema.Type;
export type CommandStreamEvent = typeof CommandStreamEventSchema.Type;
export type RepoSummary = typeof RepoSummarySchema.Type;
export type RepoSnapshot = typeof RepoSnapshotSchema.Type;
export type GuiMetadata = typeof GuiMetadataSchema.Type;
export type EvidenceRef = typeof EvidenceRefSchema.Type;
export type FindingListItem = typeof FindingListItemSchema.Type;
export type FindingDetail = typeof FindingDetailSchema.Type;
export type FeatureMapItem = typeof FeatureMapItemSchema.Type;
export type ReviewRunSummary = typeof ReviewRunSummarySchema.Type;
export type ReviewCoverage = typeof ReviewCoverageSchema.Type;
export type FeatureMapSnapshot = typeof FeatureMapSnapshotSchema.Type;

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
      note?: string
    ) => Promise<CommandResult>;
  };
  commands: {
    run: (repoId: string, request: ClawpatchCommandRequest) => Promise<CommandResult>;
    onStream: (listener: (event: CommandStreamEvent) => void) => () => void;
  };
  git: {
    diff: (repoId: string) => Promise<string>;
  };
}
