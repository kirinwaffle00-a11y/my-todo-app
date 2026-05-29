import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/authOptions";
import { logger } from "../../../lib/logger";

// [C-3] Discord Webhook URL のホワイトリスト正規表現
const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

const PRIORITY_LABEL: Record<string, string> = {
  high: "🔥 高",
  medium: "⚡ 中",
  low: "🌱 低",
};

// [M-1] @everyone / @here などのメンションを無害化
function sanitizeForDiscord(text: string, maxLen = 200): string {
  return String(text)
    .slice(0, maxLen)
    .replace(/@(everyone|here)/gi, "@\u200b$1")
    .replace(/<@[!&]?\d+>/g, "[mention]");
}

export async function POST(request: Request) {
  // [H-2] 認証チェック：ログイン済みユーザーのみ通知を送れる
  const session = await getServerSession(authOptions);
  if (!session) {
    logger.warn({ action: "discord/notify-added", status: "rejected", detail: "Unauthenticated request" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session as { userId?: string; accessToken?: string })?.userId ?? "unknown";

  try {
    const body = await request.json();
    const { webhookUrl, task } = body ?? {};

    // 必須フィールド検証
    if (typeof webhookUrl !== "string" || !webhookUrl) {
      return NextResponse.json({ error: "Missing webhookUrl" }, { status: 400 });
    }
    if (!task || typeof task !== "object") {
      return NextResponse.json({ error: "Missing task" }, { status: 400 });
    }

    // [C-3] SSRF 防止：Discord ドメインのみ許可
    if (!DISCORD_WEBHOOK_PATTERN.test(webhookUrl)) {
      logger.warn({ action: "discord/notify-added", status: "rejected", userId, detail: "Invalid webhook URL" });
      return NextResponse.json({ error: "Invalid webhook URL" }, { status: 400 });
    }

    const taskText = typeof task.text === "string" ? task.text : "";
    if (!taskText.trim()) {
      return NextResponse.json({ error: "Task text is required" }, { status: 400 });
    }

    // [M-1] サニタイズ後に Discord メッセージを構築
    const sanitizedText = sanitizeForDiscord(taskText);
    const priorityKey = typeof task.priority === "string" ? task.priority : "medium";
    const priorityText = PRIORITY_LABEL[priorityKey] ?? "⚡ 中";

    const payload = {
      username: "FocusTodo Bot",
      avatar_url: "https://raw.githubusercontent.com/kirinwaffle00-a11y/my-todo-app/main/public/icon-192x192.png",
      content: `新しいタスクが追加されました：**${sanitizedText}**（優先度：${priorityText}）`,
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // [M-3] 内部エラー詳細はログのみ。クライアントには汎用メッセージを返す
      logger.error({ action: "discord/notify-added", status: "error", userId, detail: `Discord API ${res.status}` });
      return NextResponse.json({ error: "Failed to send notification" }, { status: 502 });
    }

    logger.info({ action: "discord/notify-added", status: "success", userId });
    return NextResponse.json({ success: true });

  } catch (e) {
    logger.error({ action: "discord/notify-added", status: "error", detail: String(e) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
