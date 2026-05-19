# Clawpatch GUI

Electron + React GUI for local Clawpatch repos. The app reads `.clawpatch` state for display and uses the `clawpatch` CLI for all Clawpatch-owned mutations.

## Commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## Ownership Boundary

- Clawpatch state remains valid without this GUI.
- The GUI does not edit `.clawpatch/findings`, `.clawpatch/features`, `.clawpatch/patches`, `.clawpatch/runs`, `.clawpatch/locks`, or `.clawpatch/config.json`.
- Triage and fixes run through `clawpatch triage` and `clawpatch fix`.
- GUI-only metadata is stored under `.clawpatch/gui/state.json`.
