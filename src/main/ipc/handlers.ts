import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  ClawpatchCommandRequestSchema,
  ClawpatchStatusSchema,
  CommandResultSchema,
  FindingDetailSchema,
  FindingListSchema,
  RepoListSchema,
  RepoSnapshotSchema,
  RepoSummarySchema
} from "../../shared/schemas";
import type { CommandStreamEvent } from "../../shared/types";
import { RepoService } from "../services/repoService";
import {
  COMMANDS_RUN_CHANNEL,
  FINDINGS_GET_CHANNEL,
  FINDINGS_LIST_CHANNEL,
  GIT_DIFF_CHANNEL,
  REPO_ADD_CHANNEL,
  REPO_LIST_CHANNEL,
  REPO_REFRESH_CHANNEL,
  TRIAGE_SET_CHANNEL
} from "../../shared/ipcChannels";
import { EffectIpc, makeIpcMethod } from "./effectIpc";

const RepoIdPayload = Schema.Struct({ repoId: Schema.String });
const RepoAddPayload = Schema.Struct({ repoPath: Schema.String });
const FindingPayload = Schema.Struct({ repoId: Schema.String, findingId: Schema.String });
const TriageSetPayload = Schema.Struct({
  repoId: Schema.String,
  findingId: Schema.String,
  status: ClawpatchStatusSchema,
  note: Schema.optionalKey(Schema.String)
});
const CommandRunPayload = Schema.Struct({
  repoId: Schema.String,
  request: ClawpatchCommandRequestSchema
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
        handler: () => repos.listRepos()
      })
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: REPO_ADD_CHANNEL,
        payload: RepoAddPayload,
        result: RepoSummarySchema,
        handler: ({ repoPath }) => repos.addRepo(repoPath)
      })
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: REPO_REFRESH_CHANNEL,
        payload: RepoIdPayload,
        result: RepoSnapshotSchema,
        handler: ({ repoId }) => repos.refreshRepo(repoId)
      })
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: FINDINGS_LIST_CHANNEL,
        payload: RepoIdPayload,
        result: FindingListSchema,
        handler: ({ repoId }) => repos.listFindings(repoId)
      })
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: FINDINGS_GET_CHANNEL,
        payload: FindingPayload,
        result: FindingDetailSchema,
        handler: ({ repoId, findingId }) => repos.getFinding(repoId, findingId)
      })
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: TRIAGE_SET_CHANNEL,
        payload: TriageSetPayload,
        result: CommandResultSchema,
        handler: ({ repoId, findingId, status, note }) =>
          repos.setTriage(repoId, findingId, status, note)
      })
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: COMMANDS_RUN_CHANNEL,
        payload: CommandRunPayload,
        result: CommandResultSchema,
        handler: ({ repoId, request }) =>
          repos.runCommand(repoId, request, (event) => publishCommandStream(event))
      })
    );
    yield* ipc.handle(
      makeIpcMethod({
        channel: GIT_DIFF_CHANNEL,
        payload: RepoIdPayload,
        result: Schema.String,
        handler: ({ repoId }) => repos.readDiff(repoId)
      })
    );
  }).pipe(Effect.withSpan("ipc.installHandlers"));
