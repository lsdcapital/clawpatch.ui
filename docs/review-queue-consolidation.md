# Review-queue consolidation — migration plan

## Context

Command concurrency is currently enforced in **two** places:

- **Main (`src/main/services/repoService.ts`)** — the source of truth. `runTrackedRepoCommand`
  claims a per-repo lock with an atomic `Ref.modify` over `runningRepoCommandPaths`
  (`repoService.ts:657`), rejecting concurrent commands with `CommandAlreadyRunningError`, and
  `runCommandAtPathAfterBackgroundCommand` retries with backoff (`repoService.ts:628`,
  `BACKGROUND_COMMAND_RETRY_*`). Per-finding fix/revalidate use the analogous
  `runFindingCommandLocked` (`repoService.ts:690`).
- **Renderer (`src/renderer/src/hooks/useCommandRunner.ts`)** — a second, hand-rolled queue:
  `reviewFeatureQueueRef` + a `drainReviewFeatureQueueRef` trampoline (`useCommandRunner.ts:~311`),
  with a **re-enqueue-on-rejection rollback** (`if (!started) updateReviewFeatureQueue([next, ...rest])`),
  plus `runningRepoCommandRef`, `isTriagePendingRef` interlock, and bulk-revalidation sequencing.

The renderer queue exists only to **serialize "review this feature" commands** and to drive UI state
(`queuedReviewFeatureIds`, `runningReviewFeatureId`, `lastReviewCompletion`). It reimplements
scheduling that main already guarantees, using imperative refs — the review flagged it as the most
fragile file in the renderer.

**Goal:** one authoritative queue, in the Effect layer (main), expressed with Effect primitives;
the renderer becomes a thin view that _reflects_ server state instead of computing it.

This is a behavior-preserving change: one review at a time (today's UX), queued badges, interrupt,
and error handling all stay the same — only _where_ the logic lives changes.

## Effect primitives (all present in `effect@4.0.0-beta.73`)

- `Queue` — async producer/consumer queue (`Queue.unbounded`, `Queue.offer`, `Queue.take`).
- `Semaphore` — already used (`Semaphore.make(1)` in `repoService.ts:167`); `withPermits` makes
  callers _wait their turn_ instead of rejecting.
- `SubscriptionRef` — a `Ref` whose `.changes` is a `Stream`; the natural way to expose
  queue/running state to the UI.
- `Fiber` / `Effect.forkScoped` / `Effect.forever` — the background consumer worker.
- `Scope` / `Layer` — lifecycle (the consumer fiber is torn down with the layer).

## Target architecture

```
Renderer (React)                         Main (Effect)
────────────────                         ─────────────
enqueueReview(repoId, featureId) ──IPC──▶ ReviewQueueService.enqueue
                                            └─ Queue.offer(cmd)

                                          consumer fiber (forkScoped):
                                            forever( Queue.take ⟶ run ⟶ update state )
                                              run = runTrackedRepoCommand(... review ...)
                                              (per-repo lock still applies)

review-queue state  ◀──IPC stream──────── SubscriptionRef<ReviewQueueState>.changes
  (running, queued, lastCompletion)
```

The consumer fiber is the queue. `runTrackedRepoCommand`'s existing per-repo lock stays as the
safety backstop, so even out-of-band commands can't double-run.

### New shared contract (`src/shared/`)

- `schemas.ts`: `ReviewQueueStateSchema` =
  `{ runningFeatureId: string | null; runningRepoId: string | null; queued: Array<{ repoId, featureId }>; lastCompletion: ReviewCompletionSummary | null }`
  (lift `ReviewCompletionSummary` out of `useCommandRunner.ts` into shared types).
- `ipcChannels.ts`: `REVIEW_QUEUE_ENQUEUE_CHANNEL = "review-queue:enqueue"`,
  `REVIEW_QUEUE_DEQUEUE_CHANNEL = "review-queue:dequeue"` (cancel a pending item),
  `REVIEW_QUEUE_STATE_CHANNEL = "review-queue:state"` (push stream, mirrors `commands:stream`).
- `types.ts` `Api`: add `reviewQueue: { enqueue(repoId, featureId, options): Promise<void>;
dequeue(repoId, featureId): Promise<void>; onState(listener): () => void }`.

## Phased migration (each phase ships independently)

### Phase 0 — prep (no behavior change) ✅ done

- Moved `ReviewCompletionSummary` and `reviewCompletionSummary()` / `countFromParsedJson()` from
  `useCommandRunner.ts` into `src/shared/reviewCompletion.ts` (+ `test/shared/reviewCompletion.test.ts`),
  so main can build the summary too. `useCommandRunner` re-exports the type so existing importers are
  unchanged.
- `findUrlInJson` in `repoService.ts:~1448` was left as-is: despite looking similar it has different
  semantics (recursive URL-by-key search vs. top-level count/array-length read), so merging would
  obscure both.

### Phase 1 — `ReviewQueueService` in main ✅ done

- New `src/main/services/reviewQueueService.ts` (+ `test/main/reviewQueueService.test.ts`), an
  `Effect.Service` built with `Layer.effect` (which manages the scope in Effect 4 — there is no
  `Layer.scoped`), depending on `RepoService`.
- Holds `Queue.unbounded<QueuedReview>()` and `SubscriptionRef.make<ReviewQueueState>(empty)`; a
  `Effect.forkScoped` consumer drains one review at a time via `repos.runCommand(..., publish)`.
- Exposes `enqueue` (dedupes already-pending features), `cancel` (skip-on-take via the queued list),
  `getState`, and `changes` (`SubscriptionRef.changes(ref)` — a function in this version, not a property).
- Tests use a `Promise`-gated `RepoService.runCommand` stub to assert serialization, cancel,
  error-recovery (queue keeps draining), and dedupe.
- **Not yet wired into app boot or IPC** — kept strictly additive so startup is untouched. Wiring
  into `makeAppLayer` + the `state.changes` → `webContents.send` push happens in Phase 2.

### Phase 2 — IPC + preload + Api types

- Add handlers in `handlers.ts` for enqueue/dequeue; add the state push (model on
  `installIpcHandlers(publishCommandStream)` — pass a second `publishReviewQueueState`).
- Mirror `onStream` in `preload/index.ts` for `onState`.

### Phase 3 — renderer becomes a thin view

- In `useCommandRunner.ts`:
  - Delete `reviewFeatureQueueRef`, `drainReviewFeatureQueueRef`, `drainReviewFeatureQueue`,
    `updateReviewFeatureQueue`, and the re-enqueue rollback.
  - `enqueueReviewFeatureCommand` → `window.clawpatch.reviewQueue.enqueue(...)`.
  - Replace the local `queuedReviewFeatureIds` / `runningReviewFeatureId` / `lastReviewCompletion`
    state with values fed from a `reviewQueue.onState` subscription (a small `useReviewQueueState`
    hook backed by `useState` + `useEffect(onState)`, or a TanStack Query `subscription`).
- `runRepoCommandOnce` keeps handling non-review repo commands (init/map/doctor); only the
  _review-feature_ path moves to the service.

### Phase 4 — cleanup

- Consumers (`ReviewMapPanel.tsx`, `ClawpatchApp.tsx`) keep the same prop names
  (`queuedReviewFeatureIds` ×13, `runningReviewFeatureId` ×12, `lastReviewCompletion` ×16) — they now
  originate from the subscription, so call sites are largely unchanged.

### Phase 5 — optional

- Bulk revalidation (`revalidateFindings`) is per-finding and lower-risk; leave it in the renderer,
  or give it the same treatment later.

## Consumer fiber sketch (illustrative — Effect 4 APIs are dual/pipeable)

```ts
export const ReviewQueueServiceLive = Layer.scoped(
  ReviewQueueService,
  Effect.gen(function* () {
    const repos = yield* RepoService;
    const queue = yield* Queue.unbounded<QueuedReview>();
    const state = yield* SubscriptionRef.make<ReviewQueueState>(emptyState);

    const runOne = (cmd: QueuedReview) =>
      Effect.acquireUseRelease(
        SubscriptionRef.update(state, markRunning(cmd)), // running = cmd, queued -= cmd
        () =>
          repos
            .runCommand(cmd.repoId, cmd.request, publishCommandStream) // existing per-repo lock applies
            .pipe(
              Effect.flatMap((result) =>
                SubscriptionRef.update(state, withCompletion(cmd, result)),
              ),
            ),
        () => SubscriptionRef.update(state, markIdle), // running = null
      ).pipe(Effect.catchAll(() => SubscriptionRef.update(state, markIdle)));

    yield* Effect.forkScoped(Effect.forever(Queue.take(queue).pipe(Effect.flatMap(runOne))));

    return ReviewQueueService.of({
      enqueue: (repoId, featureId, options) =>
        SubscriptionRef.update(state, addQueued(repoId, featureId)).pipe(
          Effect.zipRight(Queue.offer(queue, makeReview(repoId, featureId, options))),
        ),
      dequeue: (repoId, featureId) =>
        SubscriptionRef.update(state, removeQueued(repoId, featureId)), // see note
      changes: state.changes,
    });
  }),
);
```

Notes / decisions:

- **Concurrency = 1** (single consumer) preserves today's "one review at a time." Per-repo
  concurrency is a later extension: key a `Map<repoId, Queue>` or gate `runOne` on a per-repo
  `Semaphore`.
- **Dequeue/cancel of an already-offered item:** simplest is a `Set<canceledKey>` the consumer
  checks in `runOne` and skips; or a `Mailbox`-style structure. Start with skip-on-take.
- The `publishCommandStream` callback is unchanged, so command output still flows over
  `commands:stream` exactly as today.

## Verification

1. **Unit (main):** test `ReviewQueueService` with the Effect test runner —
   - enqueue A,B → only A runs until A resolves, then B; `state.changes` emits the expected sequence.
   - error in A → state returns to idle and B still drains (replaces the renderer rollback test).
   - dequeue of a pending item removes it and it never runs.
     Use a stub `RepoService.runCommand` returning a controllable `Deferred` to drive ordering.
2. **Integration (renderer):** the existing `ClawpatchApp.test.tsx` queue tests
   ("queues individual review row clicks while another review is running", `:1020`, `:1099`) are the
   regression net — they should pass unchanged once the renderer reads state from `onState`.
3. **Manual, in the running Electron app (the part that can't be unit-verified):**
   - Queue 3 feature reviews quickly → badges show 1 running + 2 queued, drains in order.
   - Interrupt the running one → next starts; queue intact.
   - Trigger a failing review → queue recovers, next runs.
   - Switch repos mid-queue → behavior matches today.

## Risks & rollback

- **Blast radius:** the fix/review/PR workflow. Mitigate by migrating _only_ the review-feature path
  in Phase 3; init/map/doctor/fix/revalidate keep their current paths.
- **Guardrail:** the main per-repo lock stays, so the worst case (renderer/service disagree) still
  cannot double-run a command.
- **Rollback:** Phases 1–2 are additive (new service + channels, unused). The risky switch is Phase 3;
  keep it a single revertible commit. Optionally gate behind a flag that chooses renderer-queue vs
  service-queue during bake-in.

## Out of scope (intentionally unchanged)

- Per-finding fix/revalidate concurrency (`runFindingCommandLocked`) — already correct.
- The main-side locks and retry/backoff — they remain the safety backstop.
- Command output streaming — reused as-is.

```

```
