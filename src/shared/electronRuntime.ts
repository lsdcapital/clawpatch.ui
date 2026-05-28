import { createRequire } from "node:module";

export const requireElectron = (): typeof import("electron") =>
  createRequire(import.meta.url)("electron") as typeof import("electron");
