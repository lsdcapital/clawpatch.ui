import pino from "pino";

const supportedLogLevels = new Set<pino.LevelWithSilent>([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

export function resolveLogLevel(value: string | undefined): pino.LevelWithSilent {
  if (value !== undefined && supportedLogLevels.has(value as pino.LevelWithSilent)) {
    return value as pino.LevelWithSilent;
  }
  return "info";
}

export const logger = pino({
  name: "clawpatch-ui",
  level: resolveLogLevel(process.env["LOG_LEVEL"]),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function childLogger(subsystem: string): pino.Logger {
  return logger.child({ subsystem });
}
