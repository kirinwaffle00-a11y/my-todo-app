import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/authOptions";
import { logger } from "../../../lib/logger";

// [C-3] Discord Webhook URL のホワイトリスト正規表現
const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

export async function POST(request: Request) {
  // [H-2] 認証チェック：ログイン済みユーザーのみテスト通知を送れる
  const session = await getServerSession(authOptions);
  if (!session) {
    logger.warn({ action: "discord/test", status: "rejected", detail: "Unauthenticated request" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session as any)?.userId ?? "unknown";

  try {
    const body = await request.json();
    const { webhookUrl } = body ?? {};

    if (typeof webhookUrl !== "string" || !webhookUrl) {
      return NextResponse.json({ error: "Webhook URL is required" }, { status: 400 });
    }

    // [C-3] SSRF 防止：Discord ドメインのみ許可
    if (!DISCORD_WEBHOOK_PATTERN.test(webhookUrl)) {
      logger.warn({ action: "discord/test", status: "rejected", userId, detail: "Invalid webhook URL" });
      return NextResponse.json({ error: "Invalid webhook URL" }, { status: 400 });
    }

    const payload = {
      username: "FocusTodo Bot",
      avatar_url: "https://raw.githubusercontent.com/kirinwaffle00-a11y/my-todo-app/main/public/icon-192x192.png",
      embeds: [{
        title: "🚀 テスト通知成功！",
        description: "FocusTodo から Discord への接続が正常に確認できました！\nこれですべての通知機能をご利用いただけます。",
        color: 0x818cf8,
        timestamp: new Date().toISOString(),
        footer: { text: "FocusTodo Webhook Test" },
      }],
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // [M-3] Discord のエラー詳細はログのみ
      logger.error({ action: "discord/test", status: "error", userId, detail: `Discord API ${res.status}` });
      return NextResponse.json({ error: "Failed to send test notification" }, { status: 502 });
    }

    logger.info({ action: "discord/test", status: "success", userId });
    return NextResponse.json({ success: true });

  } catch (e) {
    logger.error({ action: "discord/test", status: "error", detail: String(e) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
