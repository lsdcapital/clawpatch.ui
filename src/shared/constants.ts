export const clawpatchStatuses = [
  "open",
  "false-positive",
  "fixed",
  "wont-fix",
  "uncertain",
] as const;

export const defaultAiAssistantCommand = 'codex "$(cat {promptFile})"';
