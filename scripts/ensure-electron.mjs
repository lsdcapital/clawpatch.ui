import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

try {
  // The electron package lazily downloads/repairs its binary when required.
  // electron-vite reads electron/path.txt directly and fails with
  // "Electron uninstall" if that repair step has not happened after an update.
  require("electron");
} catch (error) {
  console.error("Failed to prepare Electron for local development.");
  console.error("Try running `pnpm rebuild electron` and then retry.");
  throw error;
}
