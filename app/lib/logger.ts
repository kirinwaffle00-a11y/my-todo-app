/**
 * logger.ts — Structured security-aware logger
 *
 * 全 API ルートで使用する構造化ログユーティリティ。
 * インシデント発生時のフォレンジック（事後追跡）を可能にするため、
 * action / userId / status を常に付与した JSON 形式で出力する。
 */

type LogLevel = "info" | "warn" | "error";

interface LogPayload {
  action: string;
  userId?: string;
  status: "success" | "rejected" | "error" | "skipped";
  detail?: string;
  [key: string]: unknown;
}

function log(level: LogLevel, payload: LogPayload): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    ...payload,
  };
  // Vercel / Node の標準出力に JSON 形式で出力
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info: (payload: LogPayload) => log("info", payload),
  warn: (payload: LogPayload) => log("warn", payload),
  error: (payload: LogPayload) => log("error", payload),
};
