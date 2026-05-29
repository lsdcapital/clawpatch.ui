import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { JsonDecodeError } from "../errors";

export interface JsonFileStore<T> {
  readonly read: (filePath: string) => Effect.Effect<T, JsonDecodeError>;
  readonly write: (filePath: string, value: T) => Effect.Effect<T, JsonDecodeError>;
}

type ReadResult<T> =
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "valid"; readonly value: T };

// A small JSON-backed document store shared by the settings services. `read`
// returns the normalized value, or `fallback()` when the file is missing or
// unparseable; `write` stamps `updatedAt`, normalizes, and persists pretty JSON.
export function makeJsonFileStore<A extends { readonly updatedAt: string }>(options: {
  readonly name: string;
  readonly schema: Schema.Codec<A>;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly normalize: (value: A) => A;
  readonly fallback: () => A;
}): JsonFileStore<A> {
  const { name, schema, fs, path, normalize, fallback } = options;

  const readFile = Effect.fn(`${name}.readFile`)(function* (filePath: string) {
    const exists = yield* fs.exists(filePath).pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) {
      return { status: "missing" } satisfies ReadResult<A>;
    }

    const raw = yield* fs.readFileString(filePath).pipe(Effect.catch(() => Effect.succeed(null)));
    if (raw === null) {
      return { status: "invalid" } satisfies ReadResult<A>;
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => cause,
    }).pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (parsed === undefined) {
      return { status: "invalid" } satisfies ReadResult<A>;
    }

    return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
      Effect.map((value): ReadResult<A> => ({ status: "valid", value: normalize(value) })),
      Effect.catch(() => Effect.succeed({ status: "invalid" } satisfies ReadResult<A>)),
    );
  });

  return {
    read: Effect.fn(`${name}.read`)(function* (filePath: string) {
      const result = yield* readFile(filePath);
      return result.status === "valid" ? result.value : fallback();
    }),
    write: Effect.fn(`${name}.write`)(function* (filePath: string, value: A) {
      const next = normalize({ ...value, updatedAt: new Date().toISOString() });
      yield* fs
        .makeDirectory(path.dirname(filePath), { recursive: true })
        .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: filePath, cause })));
      yield* fs
        .writeFileString(filePath, `${JSON.stringify(next, null, 2)}\n`)
        .pipe(Effect.mapError((cause) => new JsonDecodeError({ path: filePath, cause })));
      return next;
    }),
  };
}
