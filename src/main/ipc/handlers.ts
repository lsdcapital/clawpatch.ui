import { BrowserWindow, dialog, shell, type OpenDialogOptions } from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  ClawpatchCommandRequestSchema,
  ClawpatchStatusSchema,
  CommandInterruptResultSchema,
  CommandResultSchema,
  FeatureMapSnapshotSchema,
  FindingDetailSchema,
  FindingListSchema,
  GitStatusSummarySchema,
  PublishFixResultSchema,
  RepoListSchema,
  RepoSnapshotSchema,
  RepoSummarySchema,
} from "../../shared/schemas";
import type { CommandStreamEvent } from "../../shared/types";
import { CommandSpawnError, DialogOpenError } from "../errors";
import { RepoService } from "../services/repoService";
import {
  COMMANDS_INTERRUPT_CHANNEL,
  COMMANDS_RUN_CHANNEL,
  FEATURES_MAP_CHANNEL,
  FINDINGS_GET_CHANNEL,
  FINDINGS_LIST_CHANNEL,
  GIT_DIFF_CHANNEL,
  GIT_PUBLISH_FIX_CHANNEL,
  GIT_STATUS_CHANNEL,
  REPO_ADD_CHANNEL,
  REPO_LIST_CHANNEL,
  REPO_PICK_FOLDER_CHANNEL,
  REPO_REFRESH_CHANNEL,
  TRIAGE_SET_CHANNEL,
} from "../../shared/ipcChannels";
import { EffectIpc, makeIpcMethod } from "./effectIpc";

const RepoIdPayload = Schema.Struct({ repoId: Schema.String });
const RepoFindingPayload = Schema.Struct({
  repoId: Schema.String,
  findingId: Schema.optionalKey(Schema.String),
});
const RepoAddPayload = Schema.Struct({ repoPath: Schema.String });
const FindingPayload = Schema.Struct({ repoId: Schema.String, findingId: Schema.String });
const TriageSetPayload = Schema.Struct({
  repoId: Schema.String,
  findingId: Schema.String,
  status: ClawpatchStatusSchema,
  note: Schema.optionalKey(Schema.String),
});
const CommandRunPayload = Schema.Struct({
  repoId: Schema.String,
  request: ClawpatchCommandRequestSchema,
});

export const installIpcHandlers = (publishCommandStream: (event: CommandStreamEvent) => void) =>
  Effect.gen(function* () {
    const ipc = yield* EffectIpc;
    const repos = yield* RepoService;

    yield* ipc.handle(
      makeIpcMethod({
        channel: REPO_LIST_CHANNEL,
        payload: Schema.Void,
        result: RepoListSchema,
        handler: () => repos.listRepos(),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: REPO_ADD_CHANNEL,
        payload: RepoAddPayload,
        result: RepoSummarySchema,
        handler: ({ repoPath }) => repos.addRepo(repoPath),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: REPO_PICK_FOLDER_CHANNEL,
        payload: Schema.Void,
        result: Schema.NullOr(Schema.String),
        handler: () => pickRepoFolder(),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: REPO_REFRESH_CHANNEL,
        payload: RepoIdPayload,
        result: RepoSnapshotSchema,
        handler: ({ repoId }) => repos.refreshRepo(repoId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: FINDINGS_LIST_CHANNEL,
        payload: RepoIdPayload,
        result: FindingListSchema,
        handler: ({ repoId }) => repos.listFindings(repoId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: FINDINGS_GET_CHANNEL,
        payload: FindingPayload,
        result: FindingDetailSchema,
        handler: ({ repoId, findingId }) => repos.getFinding(repoId, findingId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: FEATURES_MAP_CHANNEL,
        payload: RepoIdPayload,
        result: FeatureMapSnapshotSchema,
        handler: ({ repoId }) => repos.readFeatureMap(repoId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: TRIAGE_SET_CHANNEL,
        payload: TriageSetPayload,
        result: CommandResultSchema,
        handler: ({ repoId, findingId, status, note }) =>
          repos.setTriage(repoId, findingId, status, note),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: COMMANDS_RUN_CHANNEL,
        payload: CommandRunPayload,
        result: CommandResultSchema,
        handler: ({ repoId, request }) =>
          repos.runCommand(repoId, request, (event) => publishCommandStream(event)),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: COMMANDS_INTERRUPT_CHANNEL,
        payload: RepoFindingPayload,
        result: CommandInterruptResultSchema,
        handler: ({ repoId, findingId }) => repos.interruptCommand(repoId, findingId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: GIT_DIFF_CHANNEL,
        payload: RepoFindingPayload,
        result: Schema.String,
        handler: ({ repoId, findingId }) => repos.readDiff(repoId, findingId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: GIT_STATUS_CHANNEL,
        payload: RepoFindingPayload,
        result: GitStatusSummarySchema,
        handler: ({ repoId, findingId }) => repos.readGitStatus(repoId, findingId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: GIT_PUBLISH_FIX_CHANNEL,
        payload: FindingPayload,
        result: PublishFixResultSchema,
        handler: ({ repoId, findingId }) =>
          repos.publishFix(repoId, findingId).pipe(
            Effect.tap((result) =>
              Effect.tryPromise({
                try: () => shell.openExternal(result.prUrl),
                catch: (cause) => new CommandSpawnError({ repoPath: result.worktreePath, cause }),
              }),
            ),
          ),
      }),
    );
  }).pipe(Effect.withSpan("ipc.installHandlers"));

const pickRepoFolder = Effect.fn("repo.pickFolder")(function* () {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const options: OpenDialogOptions = { properties: ["openDirectory"] };
  const result = yield* Effect.tryPromise({
    try: () =>
      owner === null ? dialog.showOpenDialog(options) : dialog.showOpenDialog(owner, options),
    catch: (cause) => new DialogOpenError({ cause }),
  });

  if (result.canceled) {
    return null;
  }
  return result.filePaths[0] ?? null;
});
