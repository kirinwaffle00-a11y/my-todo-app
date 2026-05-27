import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../lib/authOptions";
import { getUserState, setUserState, UserState } from "../../lib/kv";
import fs from "fs/promises";
import path from "path";

// ── Legacy shared-file fallback (for guests / no-KV local dev) ──────────────
const DATA_DIR = path.join(process.cwd(), "data");
const GUEST_FILE = path.join(DATA_DIR, "tasks.json");

const DEFAULT_STATE: UserState = {
  tasks: [],
  categories: ["勉強用", "その他"],
  discordWebhookUrl: "",
  discordNotifyTime: "08:00",
  disciplineScore: 0,
  averageBedtime: "23:30",
  taskVelocityPerHour: 60,
};

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
  } catch (e: any) {
    if (e.code === "ENOENT") return { ...DEFAULT_STATE };
    console.error("[tasks/route] loadGuestState error:", e);
    return { ...DEFAULT_STATE };
  }
}

async function saveGuestState(state: UserState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(GUEST_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session as any)?.userId as string | undefined;

  let state: UserState;
  if (userId) {
    state = await getUserState(userId);
  } else {
    state = await loadGuestState();
  }

  return NextResponse.json(state);
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const state: UserState = {
      tasks: Array.isArray(body.tasks) ? body.tasks : [],
      categories: Array.isArray(body.categories) ? body.categories : DEFAULT_STATE.categories,
      discordWebhookUrl: typeof body.discordWebhookUrl === "string" ? body.discordWebhookUrl : "",
      discordNotifyTime: typeof body.discordNotifyTime === "string" ? body.discordNotifyTime : "08:00",
      disciplineScore: typeof body.disciplineScore === "number" ? body.disciplineScore : 0,
      averageBedtime: typeof body.averageBedtime === "string" ? body.averageBedtime : "23:30",
      taskVelocityPerHour: typeof body.taskVelocityPerHour === "number" ? body.taskVelocityPerHour : 60,
    };

    const session = await getServerSession(authOptions);
    const userId = (session as any)?.userId as string | undefined;

    if (userId) {
      await setUserState(userId, state);
    } else {
      await saveGuestState(state);
    }

    return NextResponse.json({
      success: true,
      taskCount: state.tasks.length,
      categoryCount: state.categories.length,
      hasWebhook: !!state.discordWebhookUrl,
      userId: userId ?? "guest",
    });
  } catch (e) {
    console.error("[tasks/route] POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
