export const clawpatchStatuses = [
  "open",
  "false-positive",
  "fixed",
  "wont-fix",
  "uncertain"
] as const;

export type ClawpatchStatus = (typeof clawpatchStatuses)[number];

export type ClawpatchCommandRequest =
  | { command: "status" }
  | { command: "report" }
  | { command: "review" }
  | { command: "triage"; findingId: string; status: ClawpatchStatus; note?: string }
  | { command: "fix"; findingId: string }
  | { command: "doctor" };

export interface CommandResult {
  runId: string;
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  parsedJson: unknown | null;
}

export interface CommandStreamEvent {
  runId: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface RepoSummary {
  id: string;
  name: string;
  path: string;
  hasClawpatch: boolean;
  isValid: boolean;
  lastError: string | null;
  findingCount: number;
  openFindingCount: number;
  updatedAt: string;
}

export interface RepoSnapshot {
  repo: RepoSummary;
  status: unknown | null;
  findings: FindingListItem[];
  diff: string;
  metadata: GuiMetadata;
}

export interface GuiMetadata {
  schemaVersion: 1;
  filters: {
    severity: string | null;
    status: ClawpatchStatus | null;
    search: string;
  };
  notes: Record<string, string>;
  lastSelectedFindingId: string | null;
  updatedAt: string;
}

export interface EvidenceRef {
  path: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  quote: string | null;
}

export interface FindingListItem {
  findingId: string;
  featureId: string;
  title: string;
  category: string;
  severity: string;
  confidence: string;
  triage: string | null;
  status: ClawpatchStatus;
  evidence: EvidenceRef[];
  linkedPatchAttemptIds: string[];
  createdAt: string;
  updatedAt: string;
  localNote: string | null;
}

export interface FindingDetail extends FindingListItem {
  reasoning: string;
  reproduction: string | null;
  recommendation: string;
  whyTestsDoNotAlreadyCoverThis: string | null;
  suggestedRegressionTest: string | null;
  minimumFixScope: string | null;
  feature: unknown | null;
  patchAttempts: unknown[];
  history: unknown[];
}

export interface Api {
  repo: {
    list: () => Promise<RepoSummary[]>;
    add: (repoPath: string) => Promise<RepoSummary>;
    refresh: (repoId: string) => Promise<RepoSnapshot>;
  };
  findings: {
    list: (repoId: string) => Promise<FindingListItem[]>;
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
