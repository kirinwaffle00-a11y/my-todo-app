/**
 * kv.ts — Unified data storage layer
 *
 * Priority:
 *  1. Vercel KV / Upstash Redis — when KV_REST_API_URL + KV_REST_API_TOKEN are set
 *  2. File system per-user — local development fallback
 */

import fs from "fs/promises";
import path from "path";

export interface NotToDo {
  id: string;
  text: string;
  kept?: boolean;
}

export interface PenaltySetting {
  type: "screen_time_lock" | "other";
  targetApp?: string;
  status: "active" | "executed" | "cleared";
}

export interface Task {
  id: string;
  parentId?: string;
  text: string;
  completed: boolean;
  category: string;
  priority?: "high" | "medium" | "low";
  description?: string;
  startDate?: string;
  dueDate?: string;
  dueTime?: string;
  isRoutine: boolean;
  createdAt: number;
  startedAt?: number;
  estimatedMinutes?: number;
  downgradeStatus?: "none" | "loading" | "suggested" | "accepted";
  downgradeSuggestions?: string[];
  parentTaskId?: string;
  notToDos?: NotToDo[];
  penalty?: PenaltySetting;
  notified?: boolean; // Discord notified
}

export interface UserState {
  tasks: Task[];
  categories: string[];
  discordWebhookUrl?: string;
  discordNotifyTime?: string;
  disciplineScore: number;
  averageBedtime: string;
  taskVelocityPerHour: number;
  lastDiscordDailySentDate?: string;
  updatedAt?: number;
}

const DEFAULT_STATE: UserState = {
  tasks: [],
  categories: ["勉強用", "その他"],
  discordWebhookUrl: "",
  discordNotifyTime: "08:00",
  disciplineScore: 0,
  averageBedtime: "23:30",
  taskVelocityPerHour: 60,
};

// ── KV detection ─────────────────────────────────────────────────────────────
export const KV_AVAILABLE = !!(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
);

// ── Key helper ───────────────────────────────────────────────────────────────
function userKey(userId: string): string {
  return `user:${userId}:state`;
}

// ── Upstash HTTP REST client (works with Vercel KV and standalone Upstash) ───
async function kvGet(userId: string): Promise<UserState | null> {
  const url = process.env.KV_REST_API_URL!;
  const token = process.env.KV_REST_API_TOKEN!;
  const key = userKey(userId);

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json || json.result === null) return null;

  // Upstash REST API might return a string or an object depending on how it was saved.
  let value: UserState;
  if (typeof json.result === "string") {
    try {
      value = JSON.parse(json.result);
      // If it was double-stringified in the past, parse it again
      if (typeof value === "string") {
        value = JSON.parse(value);
      }
    } catch {
      return null;
    }
  } else {
    value = json.result;
  }
  return value as UserState;
}

async function kvSet(userId: string, state: UserState): Promise<void> {
  const url = process.env.KV_REST_API_URL!;
  const token = process.env.KV_REST_API_TOKEN!;
  const key = userKey(userId);

  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // Upstash /set/key endpoint takes the value as the request body.
    // Send a single JSON string.
    body: JSON.stringify(state), 
  });
  if (!res.ok) {
    throw new Error(`KV set failed: ${res.status}`);
  }
}

// ── File system backend (local dev) ──────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), "data");

function userFilePath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `user_${safe}.json`);
}

async function fsGet(userId: string): Promise<UserState | null> {
  try {
    const content = await fs.readFile(userFilePath(userId), "utf-8");
    return JSON.parse(content) as UserState;
  } catch {
    return null;
  }
}

async function fsSet(userId: string, state: UserState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(userFilePath(userId), JSON.stringify(state, null, 2), "utf-8");
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function getUserState(userId: string): Promise<UserState & { initialized: boolean }> {
  try {
    const raw = KV_AVAILABLE ? await kvGet(userId) : await fsGet(userId);
    if (!raw) {
      // Key does not exist — new user or never saved from this account
      return { ...DEFAULT_STATE, initialized: false };
    }
    return {
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      categories: Array.isArray(raw.categories) ? raw.categories : DEFAULT_STATE.categories,
      discordWebhookUrl: raw.discordWebhookUrl ?? "",
      discordNotifyTime: raw.discordNotifyTime ?? "08:00",
      disciplineScore: raw.disciplineScore ?? 0,
      averageBedtime: raw.averageBedtime ?? "23:30",
      taskVelocityPerHour: raw.taskVelocityPerHour ?? 60,
      updatedAt: raw.updatedAt,
      initialized: true, // Key exists — trust this data (even if tasks is empty)
    };
  } catch (e) {
    console.error("[kv] getUserState error:", e);
    return { ...DEFAULT_STATE, initialized: false };
  }
}

export async function setUserState(userId: string, state: UserState): Promise<void> {
  try {
    if (KV_AVAILABLE) {
      await kvSet(userId, state);
    } else {
      await fsSet(userId, state);
    }
  } catch (e) {
    console.error("[kv] setUserState error:", e);
    throw e;
  }
}
