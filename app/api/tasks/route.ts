import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../lib/authOptions";
import { getUserState, setUserState, UserState } from "../../lib/kv";
import { logger } from "../../lib/logger";
import fs from "fs/promises";
import path from "path";

// ── ゲスト用フォールバック（ローカル開発 / KV 未設定時）─────────────────────
const DATA_DIR = path.join(process.cwd(), "data");
const GUEST_FILE = path.join(DATA_DIR, "tasks.json");

// [H-3] データ量の上限定数
const MAX_TASKS = 500;
const MAX_CATEGORIES = 50;
const MAX_TEXT_LEN = 200;
const MAX_DESCRIPTION_LEN = 1000;
const MAX_CATEGORY_LEN = 50;

const DEFAULT_STATE: UserState = {
  tasks: [],
  categories: ["勉強用", "その他"],
  discordWebhookUrl: "",
  discordNotifyTime: "08:00",
  disciplineScore: 0,
  averageBedtime: "23:30",
  taskVelocityPerHour: 60,
};

// [H-3] タスクの各フィールドを長さで切り詰める（データ爆発防止）
function sanitizeTask(t: Record<string, unknown>): Record<string, unknown> | null {
  if (!t || typeof t !== "object") return null;
  return {
    ...t,
    text: typeof t.text === "string" ? t.text.slice(0, MAX_TEXT_LEN) : "",
    description: typeof t.description === "string" ? t.description.slice(0, MAX_DESCRIPTION_LEN) : undefined,
    category: typeof t.category === "string" ? t.category.slice(0, MAX_CATEGORY_LEN) : "その他",
  };
}

async function loadGuestState(): Promise<UserState> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const content = await fs.readFile(GUEST_FILE, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return { ...DEFAULT_STATE, tasks: parsed };
    }
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : DEFAULT_STATE.categories,
      discordWebhookUrl: parsed.discordWebhookUrl ?? "",
      discordNotifyTime: parsed.discordNotifyTime ?? "08:00",
      disciplineScore: parsed.disciplineScore ?? 0,
      averageBedtime: parsed.averageBedtime ?? "23:30",
      taskVelocityPerHour: parsed.taskVelocityPerHour ?? 60,
    };
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "ENOENT") return { ...DEFAULT_STATE };
    logger.error({ action: "tasks/loadGuestState", status: "error", detail: String(e) });
    return { ...DEFAULT_STATE };
  }
}
// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session as { userId?: string; accessToken?: string })?.userId as string | undefined;

  let state: UserState & { initialized?: boolean };
  if (userId) {
    state = await getUserState(userId);
  } else {
    // [H-2] ゲスト状態の読み込みは許可（書き込みは認証必須）
    // Guest users always get initialized=false so client uses localStorage
    state = { ...(await loadGuestState()), initialized: false };
  }

  logger.info({ action: "tasks/GET", status: "success", userId: userId ?? "guest" });
  return NextResponse.json(state);
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  // [H-2] POST（書き込み）は認証必須
  const session = await getServerSession(authOptions);
  const userId = (session as { userId?: string; accessToken?: string })?.userId as string | undefined;

  if (!userId) {
    logger.warn({ action: "tasks/POST", status: "rejected", detail: "Unauthenticated write attempt" });
    // ゲストは localStorage のみで管理するため、サーバー書き込みを拒否
    // フロントエンドは 401 時もエラーを出さずローカルに保存する実装になっている
    return NextResponse.json({ error: "Authentication required to save to server" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // [H-3] タスク件数・カテゴリ件数の上限チェック
    const rawTasks = Array.isArray(body.tasks) ? body.tasks : [];
    if (rawTasks.length > MAX_TASKS) {
      logger.warn({ action: "tasks/POST", status: "rejected", userId, detail: `Task count exceeds limit: ${rawTasks.length}` });
      return NextResponse.json({ error: `Task count exceeds maximum (${MAX_TASKS})` }, { status: 400 });
    }

    const rawCats = Array.isArray(body.categories) ? body.categories : [];
    if (rawCats.length > MAX_CATEGORIES) {
      return NextResponse.json({ error: `Category count exceeds maximum (${MAX_CATEGORIES})` }, { status: 400 });
    }

    // [H-3] 各タスクフィールドのサニタイズ（長さ切り詰め）
    const sanitizedTasks = rawTasks.map(sanitizeTask).filter(Boolean);

    const state: UserState = {
      tasks: sanitizedTasks,
      categories: rawCats
        .filter((c: unknown) => typeof c === "string")
        .map((c: string) => c.slice(0, MAX_CATEGORY_LEN)),
      discordWebhookUrl: typeof body.discordWebhookUrl === "string" ? body.discordWebhookUrl : "",
      discordNotifyTime: typeof body.discordNotifyTime === "string" ? body.discordNotifyTime : "08:00",
      disciplineScore: typeof body.disciplineScore === "number"
        ? Math.max(0, Math.min(100, body.disciplineScore)) // 0-100 の範囲に制限
        : 0,
      averageBedtime: typeof body.averageBedtime === "string" ? body.averageBedtime : "23:30",
      taskVelocityPerHour: typeof body.taskVelocityPerHour === "number"
        ? Math.max(0, Math.min(1000, body.taskVelocityPerHour)) // 0-1000 の範囲に制限
        : 60,
      updatedAt: typeof body.updatedAt === "number" ? body.updatedAt : Date.now(),
    };

    await setUserState(userId, state);

    logger.info({ action: "tasks/POST", status: "success", userId, taskCount: state.tasks.length });
    return NextResponse.json({
      success: true,
      taskCount: state.tasks.length,
      categoryCount: state.categories.length,
    });

  } catch (e) {
    // [M-3] 内部エラーはログのみ
    logger.error({ action: "tasks/POST", status: "error", userId, detail: String(e) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
