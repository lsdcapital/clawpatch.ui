import type { OpenDialogOptions } from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  AppSettingsSchema,
  ClawpatchCommandRequestSchema,
  ClawpatchConfigSchema,
  ClawpatchStatusSchema,
  CommandInterruptResultSchema,
  CommandResultSchema,
  FeatureMapSnapshotSchema,
  FindingDetailSchema,
  FindingListSchema,
  FindingWorkStatusListSchema,
  GitStatusSummarySchema,
  PatchOpenPrResultSchema,
  RepoSettingsSchema,
  RepoListSchema,
  RepoSummarySchema,
  TerminalOpenResultSchema,
} from "../../shared/schemas";
import { requireElectron } from "../../shared/electronRuntime";
import type { CommandStreamEvent } from "../../shared/types";
import { CommandSpawnError, DialogOpenError } from "../errors";
import { RepoService } from "../services/repoService";
import { ReviewQueueService, type ReviewCommandRequest } from "../services/reviewQueueService";
import {
  APP_SETTINGS_GET_CHANNEL,
  APP_SETTINGS_PICK_TERMINAL_APP_CHANNEL,
  APP_SETTINGS_UPDATE_CHANNEL,
  COMMANDS_INTERRUPT_CHANNEL,
  COMMANDS_RUN_CHANNEL,
  REVIEW_QUEUE_ENQUEUE_CHANNEL,
  REVIEW_QUEUE_CANCEL_CHANNEL,
  FEATURES_MAP_CHANNEL,
  FINDINGS_GET_CHANNEL,
  FINDINGS_LIST_CHANNEL,
  FINDINGS_WORK_STATUSES_CHANNEL,
  GIT_DIFF_CHANNEL,
  GIT_STATUS_CHANNEL,
  PATCHES_OPEN_PR_CHANNEL,
  REPO_ADD_CHANNEL,
  REPO_DOCTOR_CHANNEL,
  REPO_GET_CONFIG_CHANNEL,
  REPO_GET_SETTINGS_CHANNEL,
  REPO_LIST_CHANNEL,
  REPO_PICK_FOLDER_CHANNEL,
  REPO_UPDATE_CONFIG_CHANNEL,
  REPO_UPDATE_SETTINGS_CHANNEL,
  TERMINAL_OPEN_AI_CHAT_CHANNEL,
  TERMINAL_OPEN_CHANNEL,
  TRIAGE_SET_CHANNEL,
} from "../../shared/ipcChannels";
import { EffectIpc, makeIpcMethod } from "./effectIpc";

const electron = requireElectron();
const { BrowserWindow, dialog, shell } = electron;

const RepoIdPayload = Schema.Struct({ repoId: Schema.String });
const AppSettingsPayload = Schema.Struct({ settings: AppSettingsSchema });
const RepoFindingPayload = Schema.Struct({
  repoId: Schema.String,
  findingId: Schema.optionalKey(Schema.String),
});
const RepoAddPayload = Schema.Struct({ repoPath: Schema.String });
const ClawpatchConfigPayload = Schema.Struct({
  repoId: Schema.String,
  config: ClawpatchConfigSchema,
});
const RepoSettingsPayload = Schema.Struct({ repoId: Schema.String, settings: RepoSettingsSchema });
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
const ReviewQueueEnqueuePayload = Schema.Struct({
  repoId: Schema.String,
  request: ClawpatchCommandRequestSchema,
});
const ReviewQueueCancelPayload = Schema.Struct({
  repoId: Schema.String,
  featureId: Schema.String,
});

export const installIpcHandlers = (publishCommandStream: (event: CommandStreamEvent) => void) =>
  Effect.gen(function* () {
    const ipc = yield* EffectIpc;
    const repos = yield* RepoService;

    yield* ipc.handle(
      makeIpcMethod({
        channel: APP_SETTINGS_GET_CHANNEL,
        payload: Schema.Void,
        result: AppSettingsSchema,
        handler: () => repos.getAppSettings(),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: APP_SETTINGS_PICK_TERMINAL_APP_CHANNEL,
        payload: Schema.Void,
        result: Schema.NullOr(Schema.String),
        handler: () => pickTerminalApp(),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: APP_SETTINGS_UPDATE_CHANNEL,
        payload: AppSettingsPayload,
        result: AppSettingsSchema,
        handler: ({ settings }) => repos.updateAppSettings(settings),
      }),
    );
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
        channel: REPO_DOCTOR_CHANNEL,
        payload: RepoIdPayload,
        result: CommandResultSchema,
        handler: ({ repoId }) => repos.doctor(repoId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: REPO_GET_CONFIG_CHANNEL,
        payload: RepoIdPayload,
        result: ClawpatchConfigSchema,
        handler: ({ repoId }) => repos.getConfig(repoId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: REPO_UPDATE_CONFIG_CHANNEL,
        payload: ClawpatchConfigPayload,
        result: ClawpatchConfigSchema,
        handler: ({ repoId, config }) => repos.updateConfig(repoId, config),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: REPO_GET_SETTINGS_CHANNEL,
        payload: RepoIdPayload,
        result: RepoSettingsSchema,
        handler: ({ repoId }) => repos.getSettings(repoId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: REPO_UPDATE_SETTINGS_CHANNEL,
        payload: RepoSettingsPayload,
        result: RepoSettingsSchema,
        handler: ({ repoId, settings }) => repos.updateSettings(repoId, settings),
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
        channel: FINDINGS_WORK_STATUSES_CHANNEL,
        payload: RepoIdPayload,
        result: FindingWorkStatusListSchema,
        handler: ({ repoId }) => repos.listFindingWorkStatuses(repoId),
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
        channel: PATCHES_OPEN_PR_CHANNEL,
        payload: FindingPayload,
        result: PatchOpenPrResultSchema,
        handler: ({ repoId, findingId }) =>
          repos
            .openPrForFinding(repoId, findingId, (event) => publishCommandStream(event))
            .pipe(
              Effect.tap((result) => {
                const prUrl = result.prUrl;
                return prUrl === null
                  ? Effect.void
                  : Effect.tryPromise({
                      try: () => shell.openExternal(prUrl),
                      catch: (cause) =>
                        new CommandSpawnError({ repoPath: result.worktreePath, cause }),
                    });
              }),
            ),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: TERMINAL_OPEN_CHANNEL,
        payload: RepoFindingPayload,
        result: TerminalOpenResultSchema,
        handler: ({ repoId, findingId }) => repos.openTerminal(repoId, findingId),
      }),
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: TERMINAL_OPEN_AI_CHAT_CHANNEL,
        payload: FindingPayload,
        result: TerminalOpenResultSchema,
        handler: ({ repoId, findingId }) => repos.openAiChat(repoId, findingId),
      }),
    );
  }).pipe(Effect.withSpan("ipc.installHandlers"));

// Registered separately from installIpcHandlers so the existing handler suite
// (and its tests) need not depend on ReviewQueueService.
export const installReviewQueueHandlers = Effect.fn("ipc.installReviewQueueHandlers")(function* () {
  const ipc = yield* EffectIpc;
  const reviewQueue = yield* ReviewQueueService;

  yield* ipc.handle(
    makeIpcMethod({
      channel: REVIEW_QUEUE_ENQUEUE_CHANNEL,
      payload: ReviewQueueEnqueuePayload,
      result: Schema.Void,
      handler: ({ repoId, request }) =>
        request.command === "review" && request.featureId !== undefined
          ? reviewQueue.enqueue({
              repoId,
              featureId: request.featureId,
              request: request as ReviewCommandRequest,
            })
          : Effect.void,
    }),
  );
  yield* ipc.handle(
    makeIpcMethod({
      channel: REVIEW_QUEUE_CANCEL_CHANNEL,
      payload: ReviewQueueCancelPayload,
      result: Schema.Void,
      handler: ({ repoId, featureId }) => reviewQueue.cancel(repoId, featureId),
    }),
  );
});

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

const pickTerminalApp = Effect.fn("appSettings.pickTerminalApp")(function* () {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const options: OpenDialogOptions = {
    title: "Choose Terminal App",
    buttonLabel: "Choose",
    defaultPath: "/Applications",
    filters: [{ name: "Applications", extensions: ["app"] }],
    properties: ["openFile"],
  };
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
