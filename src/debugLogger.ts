// src/debugLogger.ts
interface LogEntry {
  timestamp: Date;
  level:
    | "INFO"
    | "DEBUG"
    | "WARN"
    | "ERROR"
    | "CLASSIFY"
    | "AMMO_SELECT"
    | "DPH_CALC"
    | "AIM_CALC"
    | "RECOIL_CALC"
    | "HIT_PROB"
    | "DPS_CYCLE"
    | "FILTER";
  message: string;
  data?: any;
}

let logStore: LogEntry[] = [];
let loggingEnabled = true;

export function enableLogging(enable: boolean): void {
  loggingEnabled = enable;
}

export function log(
  level: LogEntry["level"],
  message: string,
  data?: any
): void {
  if (!loggingEnabled) return;

  const entry: LogEntry = {
    timestamp: new Date(),
    level,
    message,
    data: data
      ? typeof data === "object"
        ? JSON.parse(JSON.stringify(data))
        : data
      : undefined,
  };
  logStore.push(entry);

  const consoleArgs = [`[${level}] ${message}`];
  if (data !== undefined) {
    consoleArgs.push(data);
  }
  switch (level) {
    case "INFO":
    case "CLASSIFY":
    case "AMMO_SELECT":
    case "FILTER":
      console.info(...consoleArgs);
      break;
    case "DEBUG":
    case "DPH_CALC":
    case "AIM_CALC":
    case "RECOIL_CALC":
    case "HIT_PROB":
    case "DPS_CYCLE":
      console.debug(...consoleArgs);
      break;
    case "WARN":
      console.warn(...consoleArgs);
      break;
    case "ERROR":
      console.error(...consoleArgs);
      break;
    default:
      console.log(...consoleArgs);
  }
}

export function getLogs(): LogEntry[] {
  return [...logStore];
}
export function getLogsAsString(): string {
  return logStore
    .map(
      (entry) =>
        `${entry.timestamp.toISOString()} [${entry.level}] ${entry.message}${
          entry.data ? ` | Data: ${JSON.stringify(entry.data, null, 2)}` : ""
        }`
    )
    .join("\n");
}
export function clearLogs(): void {
  logStore = [];
}
export function downloadLogs(
  filename: string = "cdda_gun_comparison_log.txt"
): void {
  const logString = getLogsAsString();
  const blob = new Blob([logString], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
