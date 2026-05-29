import { NextResponse } from "next/server";
import { getUserState, setUserState, KV_AVAILABLE, Task } from "../../../lib/kv";
import { logger } from "../../../lib/logger";

// ── 定数 ────────────────────────────────────────────────────────────────────
const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

// [L-1] タスクフィールドの最大長
const MAX_TASK_TEXT_LEN = 200;
const MAX_DESCRIPTION_LEN = 500;

// ── JST 日時取得 ─────────────────────────────────────────────────────────────
function getJstDateTime() {
  const options = {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  } as const;
  const formatter = new Intl.DateTimeFormat("ja-JP", options);
  const parts = formatter.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    timeStr: `${get("hour")}:${get("minute")}`,
  };
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// [M-1] Discord Markdown のメンション無害化
// @everyone / @here をエスケープし、任意メンションを防ぐ
function sanitizeForDiscord(text: string): string {
  return text
    .slice(0, MAX_TASK_TEXT_LEN)
    .replace(/@(everyone|here)/gi, "@\u200b$1")   // ゼロ幅スペースを挿入
    .replace(/<@[!&]?\d+>/g, "[mention]");         // <@ID> 形式を無害化
}

function sanitizeDesc(text: string): string {
  return text
    .slice(0, MAX_DESCRIPTION_LEN)
    .replace(/@(everyone|here)/gi, "@\u200b$1")
    .replace(/<@[!&]?\d+>/g, "[mention]");
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  // ─────────────────────────────────────────────────────────────────────────
  // [C-2] CRON_SECRET による認証
  // Vercel Cron は Authorization: Bearer <CRON_SECRET> を自動付与する
  // ─────────────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error({ action: "cron/discord-daily", status: "error", detail: "CRON_SECRET env not set" });
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  // タイミング攻撃（timing attack）対策: timingSafeEqual は Web Crypto で代替
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(provided);
  const bBytes = encoder.encode(cronSecret);

  let safe = aBytes.length === bBytes.length;
  let diff = 0;
  const minLen = Math.min(aBytes.length, bBytes.length);
  for (let i = 0; i < minLen; i++) diff |= aBytes[i] ^ bBytes[i];
  safe = safe && diff === 0;

  if (!safe) {
    logger.warn({ action: "cron/discord-daily", status: "rejected", detail: "Invalid CRON_SECRET" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const bypassTimeCheck = searchParams.get("bypass_time_check") === "true";
    const { dateStr, timeStr } = getJstDateTime();

    // ─────────────────────────────────────────────────────────────────────
    // [L-3] KV が利用可能な場合は KV から読む（Vercel サーバーレスではファイルは永続化されない）
    // KV 未設定時はゲストファイルにフォールバック
    // ─────────────────────────────────────────────────────────────────────
    let webhookUrl = "";
    let notifyTime = "08:00";
    let lastSentDate = "";
    let tasks: Task[] = [];
    // KV からユーザーデータを読む（マルチユーザー対応の場合はユーザーを列挙する必要があるが、
    // 現構成は単一ゲストを想定しているため環境変数からユーザーIDを取得する）
    const cronUserId = process.env.CRON_USER_ID; // オプション: 特定ユーザーへ送る場合
    if (KV_AVAILABLE && cronUserId) {
      const state = await getUserState(cronUserId);
      webhookUrl = state.discordWebhookUrl ?? "";
      notifyTime = state.discordNotifyTime ?? "08:00";
      tasks = state.tasks;
      // KV に lastSentDate がない場合は空文字列（後で書き込む）
      lastSentDate = state.lastDiscordDailySentDate ?? "";
    } else {
      // ゲストファイルから読む（ローカル開発 or KV 未設定）
      const { getUserState: gsGuest } = await import("../../../lib/kv");
      // ゲストはファイルフォールバックのため userId = "guest" で呼び出す
      const state = await gsGuest("guest");
      webhookUrl = state.discordWebhookUrl ?? "";
      notifyTime = state.discordNotifyTime ?? "08:00";
      tasks = state.tasks;
      lastSentDate = state.lastDiscordDailySentDate ?? "";
    }

    if (!webhookUrl) {
      logger.info({ action: "cron/discord-daily", status: "skipped", detail: "Webhook URL not configured" });
      return NextResponse.json({ error: "Discord Webhook URL is not configured" }, { status: 400 });
    }

    // [C-3] Webhook URL のホワイトリスト検証（SSRF 防止）
    if (!DISCORD_WEBHOOK_PATTERN.test(webhookUrl)) {
      logger.warn({ action: "cron/discord-daily", status: "rejected", detail: "Invalid webhook URL format" });
      return NextResponse.json({ error: "Invalid webhook URL" }, { status: 400 });
    }

    // 時刻チェック
    if (!bypassTimeCheck) {
      if (lastSentDate === dateStr) {
        logger.info({ action: "cron/discord-daily", status: "skipped", detail: `Already sent today: ${dateStr}` });
        return NextResponse.json({ message: `Already sent today (${dateStr})`, skipped: true });
      }
      const diff = timeToMinutes(timeStr) - timeToMinutes(notifyTime);
      if (diff < 0 || diff > 45) {
        logger.info({ action: "cron/discord-daily", status: "skipped", detail: `Outside window: ${timeStr}` });
        return NextResponse.json({ message: `Outside trigger window (${timeStr})`, skipped: true });
      }
    }

    // タスクフィルタ
    const todayTasks = tasks.filter(
      (t: Task) => t && !t.completed && t.dueDate === dateStr
    );
    const high = todayTasks.filter((t: Task) => t.priority === "high");
    const medium = todayTasks.filter((t: Task) => t.priority === "medium" || !t.priority);
    const low = todayTasks.filter((t: Task) => t.priority === "low");

    // [M-1] フォーマット時にサニタイズ
    const formatTaskList = (list: Task[]) => {
      if (list.length === 0) return "• なし\n";
      return list.map((t: Task) => {
        const text = sanitizeForDiscord(String(t.text ?? ""));
        const timeBadge = t.dueTime ? ` [${t.dueTime}]` : "";
        const catBadge = t.category ? ` \`[${sanitizeForDiscord(String(t.category))}]\`` : "";
        const descText = t.description ? ` *(メモ: ${sanitizeDesc(String(t.description))})*` : "";
        return `• **${text}**${timeBadge}${catBadge}${descText}`;
      }).join("\n") + "\n";
    };

    const formattedDate = dateStr.replace(/-/g, "/");
    const payload = {
      username: "FocusTodo Bot",
      avatar_url: "https://raw.githubusercontent.com/kirinwaffle00-a11y/my-todo-app/main/public/icon-192x192.png",
      embeds: [{
        title: `📅 本日のタスクまとめ (${formattedDate})`,
        description: "本日締め切りを迎える未完了のタスク一覧です。今日も一歩ずつ集中して進めましょう！🍅",
        color: 0x3b82f6,
        fields: [
          { name: "🔥 優先度：高（今日絶対）", value: formatTaskList(high), inline: false },
          { name: "⚡ 優先度：中（お早めに）", value: formatTaskList(medium), inline: false },
          { name: "🌱 優先度：低（できれば）", value: formatTaskList(low), inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "FocusTodo Daily Notifications" },
      }],
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // [M-3] Discord API エラーはログに残すが、クライアントには汎用メッセージのみ返す
      const errText = await res.text();
      logger.error({ action: "cron/discord-daily", status: "error", detail: `Discord API error: ${res.status}`, discordBody: errText.slice(0, 200) });
      return NextResponse.json({ error: "Failed to send Discord notification" }, { status: 502 });
    }

    // [L-3] 送信済みフラグを KV に書き込む（ファイル依存を廃止）
    if (!bypassTimeCheck) {
      if (KV_AVAILABLE && cronUserId) {
        const state = await getUserState(cronUserId);
        await setUserState(cronUserId, { ...state, lastDiscordDailySentDate: dateStr });
      }
      // ゲストファイルへの書き込みはローカル開発時のみのため許容する
    }

    logger.info({ action: "cron/discord-daily", status: "success", detail: `Sent for ${dateStr}`, taskCount: todayTasks.length });
    return NextResponse.json({ success: true, sentDate: dateStr, taskCount: todayTasks.length });

  } catch (e) {
    // [M-3] 内部エラーはログのみ。スタックトレースはクライアントに渡さない
    logger.error({ action: "cron/discord-daily", status: "error", detail: String(e) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
