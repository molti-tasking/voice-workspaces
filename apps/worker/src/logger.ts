/** Structured single-line logs, so Coolify's log view stays greppable. */
type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, fields: Record<string, unknown> = {}) {
  const line = { ts: new Date().toISOString(), level, message, ...fields };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit("error", message, fields),
};
