import * as Effect from "effect/Effect";

type CatchAll = {
  <E, A2, E2, R2>(
    f: (error: E) => Effect.Effect<A2, E2, R2>,
  ): <A, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A | A2, E2, R | R2>;
  <A, E, R, A2, E2, R2>(
    self: Effect.Effect<A, E, R>,
    f: (error: E) => Effect.Effect<A2, E2, R2>,
  ): Effect.Effect<A | A2, E2, R | R2>;
};

const effectWithCatchAll = Effect as typeof Effect & { readonly catchAll?: CatchAll };

export const catchAll = ((selfOrHandler: unknown, handler?: unknown) => {
  const implementation = effectWithCatchAll.catchAll ?? Effect.catch;
  if (handler === undefined) {
    return (implementation as (handler: unknown) => unknown)(selfOrHandler);
  }
  return (implementation as (self: unknown, handler: unknown) => unknown)(selfOrHandler, handler);
}) as CatchAll;
