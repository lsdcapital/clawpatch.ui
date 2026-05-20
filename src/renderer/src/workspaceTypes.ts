import type { CommandResult, CommandStreamEvent } from "../../shared/types";

export type CommandLogEntry =
  | { kind: "stream"; event: CommandStreamEvent }
  | {
      kind: "result";
      result: CommandResult;
      repoId: string;
      findingId?: string;
      command: string;
    }
  | { kind: "error"; message: string; repoId?: string; findingId?: string; command?: string };

export type ActiveWorkspace = "findings" | "reviewQueue";
export type ActiveInspector = "diff" | "output" | null;
