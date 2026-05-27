import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "tasks.json");

interface SyncState {
  tasks: any[];
  categories: string[];
  discordWebhookUrl?: string;
  discordNotifyTime?: string;
  lastDiscordDailySentDate?: string;
}

async function loadState(): Promise<SyncState> {
  try {
    const fileContent = await fs.readFile(FILE_PATH, "utf-8");
    const parsed = JSON.parse(fileContent);
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : ["勉強用", "その他"],
      discordWebhookUrl: parsed.discordWebhookUrl || "",
      discordNotifyTime: parsed.discordNotifyTime || "08:00",
      lastDiscordDailySentDate: parsed.lastDiscordDailySentDate || "",
    };
  } catch (error) {
    return {
      tasks: [],
      categories: ["勉強用", "その他"],
      discordWebhookUrl: "",
      discordNotifyTime: "08:00",
      lastDiscordDailySentDate: "",
    };
  }
}

async function saveState(state: SyncState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

// Helper to get current JST date and time
function getJstDateTime() {
  const options = { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false } as const;
  const formatter = new Intl.DateTimeFormat("ja-JP", options);
  const parts = formatter.formatToParts(new Date());
  
  const year = parts.find(p => p.type === "year")?.value || "";
  const month = parts.find(p => p.type === "month")?.value || "";
  const day = parts.find(p => p.type === "day")?.value || "";
  const hour = parts.find(p => p.type === "hour")?.value || "";
  const minute = parts.find(p => p.type === "minute")?.value || "";
  
  return {
    dateStr: `${year}-${month}-${day}`, // YYYY-MM-DD format
    timeStr: `${hour}:${minute}`,       // HH:MM format
    hour: parseInt(hour, 10),
    minute: parseInt(minute, 10),
  };
}

// Convert "HH:MM" to minutes from midnight
function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const bypassTimeCheck = searchParams.get("bypass_time_check") === "true";

    const state = await loadState();
    const webhookUrl = state.discordWebhookUrl;

    if (!webhookUrl) {
      return NextResponse.json({ error: "Discord Webhook URL is not configured" }, { status: 400 });
    }

    const { dateStr, timeStr } = getJstDateTime();
    const targetTime = state.discordNotifyTime || "08:00";

    // Time matching logic
    if (!bypassTimeCheck) {
      // 1. Check if already sent today
      if (state.lastDiscordDailySentDate === dateStr) {
        return NextResponse.json({ message: `Daily summary already sent today (${dateStr})`, skipped: true });
      }

      // 2. Check if the current time is past the target notification time (with 45-minute trigger window)
      const currentMin = timeToMinutes(timeStr);
      const targetMin = timeToMinutes(targetTime);
      const diff = currentMin - targetMin;

      // Allow trigger if we are at or up to 45 minutes past the target time.
      // This absorbs latency or slightly spaced cron interval runs (e.g. 15 or 30 mins crons).
      if (diff < 0 || diff > 45) {
        return NextResponse.json({ 
          message: `Current JST time (${timeStr}) is outside trigger window for settings target (${targetTime})`, 
          skipped: true 
        });
      }
    }

    // Filter tasks due today (JST) that are NOT completed
    // Due date format is "YYYY-MM-DD"
    const todayTasks = state.tasks.filter((task: any) => {
      if (!task || task.completed) return false;
      return task.dueDate === dateStr;
    });

    // Group by priority
    const high = todayTasks.filter((t: any) => t.priority === "high");
    const medium = todayTasks.filter((t: any) => t.priority === "medium" || !t.priority);
    const low = todayTasks.filter((t: any) => t.priority === "low");

    // Format Markdown description list
    const formatTaskList = (list: any[]) => {
      if (list.length === 0) return "• なし\n";
      return list.map((t: any) => {
        const timeBadge = t.dueTime ? ` [${t.dueTime}]` : "";
        const catBadge = t.category ? ` \`[${t.category}]\`` : "";
        const descText = t.description ? ` *(メモ: ${t.description})*` : "";
        return `• **${t.text}**${timeBadge}${catBadge}${descText}`;
      }).join("\n") + "\n";
    };

    const formattedDate = dateStr.replace(/-/g, "/");
    
    const payload = {
      username: "FocusTodo Bot",
      avatar_url: "https://raw.githubusercontent.com/kirinwaffle00-a11y/my-todo-app/main/public/icon-192x192.png",
      embeds: [
        {
          title: `📅 本日のタスクまとめ (${formattedDate})`,
          description: "本日締め切りを迎える未完了のタスク一覧です。今日も一歩ずつ集中して進めましょう！🍅",
          color: 0x3b82f6, // Calm Blue color
          fields: [
            {
              name: "🔥 優先度：高（今日絶対）",
              value: formatTaskList(high),
              inline: false,
            },
            {
              name: "⚡ 優先度：中（お早めに）",
              value: formatTaskList(medium),
              inline: false,
            },
            {
              name: "🌱 優先度：低（できれば）",
              value: formatTaskList(low),
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: "FocusTodo Daily Notifications",
          },
        },
      ],
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Discord API Error: ${errText}` }, { status: res.status });
    }

    // Update state to record this send, preventing duplicate cron runs today
    if (!bypassTimeCheck) {
      state.lastDiscordDailySentDate = dateStr;
      await saveState(state);
    }

    return NextResponse.json({ 
      success: true, 
      sentDate: dateStr, 
      taskCount: todayTasks.length,
      bypassed: bypassTimeCheck 
    });

  } catch (error: any) {
    console.error("Error executing daily task cron:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
