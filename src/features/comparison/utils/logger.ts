// src/features/comparison/utils/logger.ts

import { writable, get } from "svelte/store";

// --- Types and State ---

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG" | "SUCCESS";

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  data?: any;
}

// A reactive Svelte store to hold all log entries in memory.
export const logs = writable<LogEntry[]>([]);

// --- Core Logging Functions ---

/**
 * The main logging function. Logs to the console and saves to the in-memory store.
 * @param level The severity of the log message.
 * @param message The main log message.
 * @param data Optional data object to be displayed in a collapsed console group.
 */
export function log(level: LogLevel, message: string, data?: any) {
  const newEntry: LogEntry = {
    timestamp: new Date(),
    level,
    message,
    data,
  };

  // 1. Log to the browser's console with appropriate colors and methods
  const style = `font-weight: bold;`;
  const consoleMessage = `%c[${level}]%c ${message}`;
  
  let color = "";
  switch (level) {
    case "INFO":    color = "color: #6495ED;"; break;
    case "SUCCESS": color = "color: #32CD32;"; break;
    case "WARN":    color = "color: #FFD700;"; break;
    case "ERROR":   color = "color: #DC143C;"; break;
    case "DEBUG":   color = "color: #9370DB;"; break;
  }

  if (data) {
    console.groupCollapsed(consoleMessage, `${style} ${color}`, "color: default;");
    console.log(data);
    console.groupEnd();
  } else {
    console.log(consoleMessage, `${style} ${color}`, "color: default;");
  }

  // 2. Add the log entry to our reactive store
  logs.update(currentLogs => [...currentLogs, newEntry]);
}

/**
 * Clears all logs from the in-memory store.
 */
export function clearLogs() {
  logs.set([]);
  log("INFO", "Debug logs cleared.");
}

/**
 * Converts the entire log history into a formatted string.
 */
function getLogsAsString(): string {
  const allLogs = get(logs); // Get the current value of the store
  if (allLogs.length === 0) {
    return "No log entries yet.";
  }
  return allLogs.map(entry => {
    const time = entry.timestamp.toISOString();
    const dataStr = entry.data ? `\n${JSON.stringify(entry.data, null, 2)}` : "";
    return `[${time}] [${entry.level}] ${entry.message}${dataStr}`;
  }).join("\n\n");
}


/**
 * Triggers a browser download of the complete log history as a text file.
 */
export function downloadLogs() {
  const logContent = getLogsAsString();
  const blob = new Blob([logContent], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = `hhg-compare-log-${new Date().toISOString()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  log("SUCCESS", "Log file download initiated.");
}