import type {
  ClawpatchCommandRequestSchema,
  ClawpatchStatusSchema,
  CommandResultSchema,
  CommandStreamEventSchema,
  EvidenceRefSchema,
  FindingDetailSchema,
  FindingListItemSchema,
  GuiMetadataSchema,
  RepoSnapshotSchema,
  RepoSummarySchema
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
