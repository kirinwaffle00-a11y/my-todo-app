import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

// Define folder and file database paths
const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "tasks.json");

// Structure of our unified sync state
interface SyncState {
  tasks: any[];
  categories: string[];
  discordWebhookUrl?: string;
  discordNotifyTime?: string;
}

// Default state if tasks.json doesn't exist
const DEFAULT_STATE: SyncState = {
  tasks: [],
  categories: ["勉強用", "その他"], // Default built-in categories
  discordWebhookUrl: "",
  discordNotifyTime: "08:00"
};

// Helper to safely read and auto-migrate tasks database schema
async function loadState(): Promise<SyncState> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const fileContent = await fs.readFile(FILE_PATH, "utf-8");
    const parsed = JSON.parse(fileContent);

    // Auto-migration: if the existing file is just a legacy array of tasks
    if (Array.isArray(parsed)) {
      return {
        tasks: parsed,
        categories: DEFAULT_STATE.categories,
        discordWebhookUrl: DEFAULT_STATE.discordWebhookUrl,
        discordNotifyTime: DEFAULT_STATE.discordNotifyTime,
      };
    }

    // Standard schema validation
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : DEFAULT_STATE.categories,
      discordWebhookUrl: typeof parsed.discordWebhookUrl === "string" ? parsed.discordWebhookUrl : DEFAULT_STATE.discordWebhookUrl,
      discordNotifyTime: typeof parsed.discordNotifyTime === "string" ? parsed.discordNotifyTime : DEFAULT_STATE.discordNotifyTime,
    };
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return DEFAULT_STATE;
    }
    console.error("Error reading tasks.json, resetting to default state:", error);
    return DEFAULT_STATE;
  }
}

// Helper to safely save state
async function saveState(state: SyncState): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing to tasks.json:", error);
    throw error;
  }
}

// GET handler: Returns both the task list and categories list
export async function GET() {
  const state = await loadState();
  return NextResponse.json(state);
}

// POST handler: Saves the updated tasks and categories state
export async function POST(request: Request) {
  try {
    const updatedState = await request.json();
    
    // Validate request structure
    if (!updatedState || typeof updatedState !== "object") {
      return NextResponse.json({ error: "Invalid state format" }, { status: 400 });
    }

    const tasks = Array.isArray(updatedState.tasks) ? updatedState.tasks : [];
    const categories = Array.isArray(updatedState.categories) ? updatedState.categories : DEFAULT_STATE.categories;
    const discordWebhookUrl = typeof updatedState.discordWebhookUrl === "string" ? updatedState.discordWebhookUrl : "";
    const discordNotifyTime = typeof updatedState.discordNotifyTime === "string" ? updatedState.discordNotifyTime : "08:00";

    const stateToSave: SyncState = { tasks, categories, discordWebhookUrl, discordNotifyTime };
    await saveState(stateToSave);

    return NextResponse.json({ 
      success: true, 
      taskCount: tasks.length, 
      categoryCount: categories.length,
      hasWebhook: !!discordWebhookUrl
    });
  } catch (error) {
    console.error("Error handling POST /api/tasks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
