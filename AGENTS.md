# Agent Instructions

## Vendored Repositories

This project vendors external repositories under `repos/` for coding-agent reference.

- Use vendored repositories as read-only reference material when working with related libraries.
- Prefer examples and patterns from vendored source code over generated guesses or fragmented web search results.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/`; application code should continue importing from normal package dependencies.

When writing Effect code, inspect `repos/effect/` for examples of idiomatic usage, tests, module structure, and API design. The app tracks npm `beta` specs for Effect packages, while `repos/effect` follows upstream Git `main`, so typecheck and tests are authoritative if the vendored source is ahead of the resolved package versions.

## Updating Effect References

Update the vendored Effect source with:

```sh
git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash
```

Update resolved npm beta packages with:

```sh
pnpm update effect @effect/platform-node @effect/vitest
```
