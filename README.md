# Clawpatch UI

Clawpatch UI is a developer-preview desktop app for working with local
[Clawpatch](https://clawpatch.ai) repos. It provides an Electron + React interface
for browsing findings, reviewing feature maps, triaging results, viewing diffs,
and running Clawpatch commands without leaving the app.

This repository contains the UI only. It is not published as an npm package, even
though it uses `package.json` for local development scripts and dependency
management. Clawpatch-owned state and mutations remain owned by the external
`clawpatch` CLI.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.1.3, preferably through Corepack
- Git 2.x
- The `clawpatch` CLI installed and available on your `PATH`

Install Clawpatch from the official docs:

```bash
npm install -g clawpatch
clawpatch doctor
```

See [clawpatch.ai](https://clawpatch.ai) for full CLI documentation.

## Install And Run

Clone or fork the repo, then install dependencies and start the Electron app:

```bash
git clone https://github.com/lsdcapital/clawpatch-ui.git
cd clawpatch-ui
corepack enable
pnpm install
pnpm dev
```

The dev command starts the Electron/Vite app. Add a local repo from the sidebar
after the app opens.

## Prepare A Target Repo

Clawpatch UI works with repos that already have `.clawpatch` state. In the repo
you want to inspect, run:

```bash
clawpatch doctor
clawpatch init
clawpatch map
clawpatch review --limit 10
```

After that, open Clawpatch UI and add the target repo path. The UI reads the
generated `.clawpatch` state and runs supported commands through the CLI.

## Available Scripts

```bash
pnpm dev         # Start the Electron/Vite dev app
pnpm build       # Build the app into out/
pnpm dist        # Build packaged app artifacts into release/
pnpm preview     # Preview the built Electron app
pnpm test        # Run Vitest once
pnpm test:watch  # Run Vitest in watch mode
pnpm typecheck   # Run TypeScript without emitting files
pnpm lint        # Run oxlint
pnpm fmt         # Format with oxfmt
pnpm fmt:check   # Check formatting with oxfmt
pnpm check       # Run typecheck, lint, format check, and tests
pnpm check:ci    # Run checks plus build
pnpm clean       # Remove generated build/cache output
```

## Ownership And Safety Boundary

- Clawpatch state remains valid without this UI.
- The UI reads `.clawpatch` state for display.
- The UI stores UI-only metadata in the app user data directory.
- Legacy `.clawpatch/ui/state.json` files are read only for migration.
- Clawpatch commands are run through `clawpatch --json --no-color --no-input`.
- Diffs are read with `git diff --no-color`.
- The UI does not directly edit `.clawpatch/findings`, `.clawpatch/features`,
  `.clawpatch/patches`, `.clawpatch/runs`, `.clawpatch/locks`, or
  `.clawpatch/config.json`.
- Triage and fixes run through `clawpatch triage` and `clawpatch fix`.

## Troubleshooting

### `clawpatch` is not found

Install the CLI and confirm it is on your `PATH`:

```bash
npm install -g clawpatch
clawpatch doctor
```

If `pnpm dev` launches the app but commands fail, restart the terminal or shell
session so Electron inherits the updated `PATH`.

### The app says no `.clawpatch` state was found

Run `clawpatch init`, `clawpatch map`, and at least one review command in the
target repo before adding it to the UI.

### Install or build fails

Confirm your Node.js and pnpm versions:

```bash
node --version
pnpm --version
corepack enable
pnpm install
```

If dependencies are stale, refresh them with:

```bash
pnpm install --frozen-lockfile
```

For a clean local rebuild:

```bash
pnpm clean
pnpm install
pnpm build
```

## Contributing

Public forks and pull requests are welcome. Before opening a PR, run:

```bash
pnpm check
```

Keep the Clawpatch CLI as the source of truth for Clawpatch-owned state. Changes
to the UI should stay compatible with the CLI state format and should not bypass
the existing command boundary for triage, fixes, reviews, or validation.

## License

Clawpatch UI is released under the MIT License. See [LICENSE](LICENSE).
