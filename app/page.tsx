"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import confetti from "canvas-confetti";
import MindMapView from "./components/MindMapView";

// ── Task interface ──────────────────────────────────────────────────────────
export interface Task {
  id: string;
  parentId?: string;
  text: string;
  description?: string;
  completed: boolean;
  category: string;
  priority: "high" | "medium" | "low";
  isRoutine: boolean;
  lastRoutineDate?: string; // "YYYY-MM-DD" — the date routine was last completed
  startDate?: string;
  dueDate?: string;
  dueTime?: string;
  notified?: boolean;
  gcalEventId?: string;   // Google Calendar event ID for auto-sync
  createdAt: number;
  startedAt?: number;
  estimatedMinutes?: number;
  downgradeStatus?: "none" | "loading" | "suggested" | "accepted";
  downgradeSuggestions?: string[];
  parentTaskId?: string;
  notToDos?: { id: string; text: string; kept?: boolean }[];
  penalty?: { type: "screen_time_lock" | "other"; targetApp?: string; status: "active" | "executed" | "cleared" };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const PRIORITY_LABEL: Record<Task["priority"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

// ── Component ────────────────────────────────────────────────────────────────
export default function Home() {
  // ── Google OAuth session ──
  const { data: session } = useSession();
  const gcalEnabled = !!(session as { accessToken?: string })?.accessToken;
  // ── Sync States ──
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<string[]>(["勉強用", "その他"]);
  const [disciplineScore, setDisciplineScore] = useState(0);
  const [averageBedtime, setAverageBedtime] = useState("23:30");
  const [taskVelocityPerHour, setTaskVelocityPerHour] = useState(60);

  // ── Discord Notification States ──
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [discordNotifyTime, setDiscordNotifyTime] = useState("08:00");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isTestingDiscord, setIsTestingDiscord] = useState(false);
  const [testStatus, setTestStatus] = useState<null | "success" | "error">(null);
  
  // ── Toast Alert ──
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Timer Toggle ──
  const [timerOpen, setTimerOpen] = useState(true);

  // ── Priority Accordion ──
  const [collapsedPriorities, setCollapsedPriorities] = useState<Set<string>>(new Set());

  // ── Task Edit Modal States ──
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editParentId, setEditParentId] = useState<string | "">("");
  const [editText, setEditText] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("勉強用");
  const [editPriority, setEditPriority] = useState<Task["priority"]>("medium");
  const [editStartDate, setEditStartDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editDueTime, setEditDueTime] = useState("");
  const [editIsRoutine, setEditIsRoutine] = useState(false);
  const [editEstimatedMinutes, setEditEstimatedMinutes] = useState<number | "">("");
  const [editNotToDosText, setEditNotToDosText] = useState("");
  const [editPenaltyType, setEditPenaltyType] = useState<"none" | "screen_time_lock" | "other">("none");
  const [editPenaltyTarget, setEditPenaltyTarget] = useState("");

  // ── Form States ──
  const [inputText, setInputText] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("勉強用");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [isRoutine, setIsRoutine] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");

  // ── Category UI ──
  const [showNewCatInput, setShowNewCatInput] = useState(false);
  const [newCatText, setNewCatText] = useState("");

  // ── UI States ──
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [mapRootTaskId, setMapRootTaskId] = useState<string | null>(null);
  const [collapsedTreeIds, setCollapsedTreeIds] = useState<Set<string>>(new Set());

  const toggleTreeCollapse = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedTreeIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };
  const [showOptions, setShowOptions] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");

  // ── Pomodoro Timer ──
  const [workDuration, setWorkDuration] = useState(25);
  const [breakDuration, setBreakDuration] = useState(5);
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerMode, setTimerMode] = useState<"work" | "break">("work");
  const [timerCycles, setTimerCycles] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Sync Refs ──
  const isLoaded = useRef(false);
  const lastLocalWrite = useRef<number>(0);
  const serverAvailable = useRef<boolean>(true);
  const categoryRef = useRef(category);
  useEffect(() => { categoryRef.current = category; }, [category]);

  // ── localStorage ──────────────────────────────────────────────────────────
  const LS_TASKS = "focustodo_tasks";
  const LS_CATS  = "focustodo_categories";
  const LS_LAST_WRITE = "focustodo_last_write";
  const LS_DISCORD_WEBHOOK = "focustodo_discord_webhook";
  const LS_DISCORD_TIME = "focustodo_discord_time";
  const LS_DISCIPLINE = "focustodo_discipline";
  const LS_BEDTIME = "focustodo_bedtime";
  const LS_VELOCITY = "focustodo_velocity";

  const loadFromLocalStorage = (): { 
    tasks: Task[]; categories: string[]; lastWrite: number; 
    discordWebhookUrl: string; discordNotifyTime: string;
    disciplineScore: number; averageBedtime: string; taskVelocityPerHour: number;
  } => {
    try {
      const t = localStorage.getItem(LS_TASKS);
      const c = localStorage.getItem(LS_CATS);
      const w = localStorage.getItem(LS_LAST_WRITE);
      const dw = localStorage.getItem(LS_DISCORD_WEBHOOK) || "";
      const dt = localStorage.getItem(LS_DISCORD_TIME) || "08:00";
      const disc = localStorage.getItem(LS_DISCIPLINE);
      const bed = localStorage.getItem(LS_BEDTIME);
      const vel = localStorage.getItem(LS_VELOCITY);
      
      const rawTasks: Task[] = t ? JSON.parse(t) : [];
      const migratedTasks = rawTasks.map((task: Partial<Task>) => ({
        priority: "medium" as Task["priority"],
        isRoutine: false,
        ...task,
      } as Task));
      return {
        tasks: migratedTasks,
        categories: c ? JSON.parse(c) : ["勉強用", "その他"],
        lastWrite: w ? Number(w) : 0,
        discordWebhookUrl: dw,
        discordNotifyTime: dt,
        disciplineScore: disc ? Number(disc) : 0,
        averageBedtime: bed || "23:30",
        taskVelocityPerHour: vel ? Number(vel) : 60,
      };
    } catch {
      return { 
        tasks: [], categories: ["勉強用", "その他"], lastWrite: 0, 
        discordWebhookUrl: "", discordNotifyTime: "08:00",
        disciplineScore: 0, averageBedtime: "23:30", taskVelocityPerHour: 60 
      };
    }
  };

  const saveToLocalStorage = (
    t: Task[], c: string[], dw?: string, dt?: string, 
    disciplineScore?: number, averageBedtime?: string, taskVelocityPerHour?: number
  ) => {
    try {
      const now = Date.now();
      localStorage.setItem(LS_TASKS, JSON.stringify(t));
      localStorage.setItem(LS_CATS, JSON.stringify(c));
      localStorage.setItem(LS_LAST_WRITE, String(now));
      if (dw !== undefined) localStorage.setItem(LS_DISCORD_WEBHOOK, dw);
      if (dt !== undefined) localStorage.setItem(LS_DISCORD_TIME, dt);
      if (disciplineScore !== undefined) localStorage.setItem(LS_DISCIPLINE, String(disciplineScore));
      if (averageBedtime !== undefined) localStorage.setItem(LS_BEDTIME, averageBedtime);
      if (taskVelocityPerHour !== undefined) localStorage.setItem(LS_VELOCITY, String(taskVelocityPerHour));
    } catch { /* localStorage unavailable */ }
  };

  // ── Routine auto-restore ──────────────────────────────────────────────────
  const applyRoutineRestore = (taskList: Task[]): Task[] => {
    const today = todayISO();
    return taskList.map((task) => {
      if (task.isRoutine && task.completed && task.lastRoutineDate !== today) {
        return { ...task, completed: false, lastRoutineDate: undefined, notified: false };
      }
      return task;
    });
  };

  // ── Server Fetch ──────────────────────────────────────────────────────────
  const fetchState = useCallback(async () => {
    if (!serverAvailable.current) return;
    const timeSinceWrite = Date.now() - lastLocalWrite.current;
    if (timeSinceWrite < 30000) return;

    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get("content-type");
      if (!ct?.includes("application/json")) throw new Error("Non-JSON");
      const data = await res.json();
      if (!data || typeof data !== "object") throw new Error("Invalid");

      const serverTasks: Task[] = (data.tasks || []).map((task: Partial<Task>) => ({
        priority: "medium" as Task["priority"],
        isRoutine: false,
        ...task,
        category: task.category === "study" ? "勉強用" : task.category === "other" ? "その他" : task.category,
      } as Task));
      const serverCats: string[] = (data.categories || ["勉強用", "その他"]).map((c: string) =>
        c === "study" ? "勉強用" : c === "other" ? "その他" : c
      );
      const serverWebhook = data.discordWebhookUrl || "";
      const serverTime = data.discordNotifyTime || "08:00";
      const serverDiscipline = data.disciplineScore || 0;
      const serverBedtime = data.averageBedtime || "23:30";
      const serverVelocity = data.taskVelocityPerHour || 60;

      const local = loadFromLocalStorage();
      // ── Source-of-truth: server always wins when authenticated ──
      // Old length-comparison caused mobile to show stale data after deleting on PC.
      // The server holds the canonical state for logged-in users.
      const serverHasData = serverTasks.length > 0 || data.tasks !== undefined;
      const finalTasks = applyRoutineRestore(serverHasData ? serverTasks : local.tasks);
      const finalCats = serverHasData ? serverCats : local.categories;
      const finalWebhook = serverHasData ? serverWebhook : local.discordWebhookUrl;
      const finalTime = serverHasData ? serverTime : local.discordNotifyTime;
      const finalDiscipline = serverHasData ? serverDiscipline : local.disciplineScore;
      const finalBedtime = serverHasData ? serverBedtime : local.averageBedtime;
      const finalVelocity = serverHasData ? serverVelocity : local.taskVelocityPerHour;

      setTasks(finalTasks);
      setCategories(finalCats);
      setDiscordWebhookUrl(finalWebhook);
      setDiscordNotifyTime(finalTime);
      setDisciplineScore(finalDiscipline);
      setAverageBedtime(finalBedtime);
      setTaskVelocityPerHour(finalVelocity);
      saveToLocalStorage(finalTasks, finalCats, finalWebhook, finalTime, finalDiscipline, finalBedtime, finalVelocity);
      lastLocalWrite.current = Date.now();
      if (!finalCats.includes(categoryRef.current) && finalCats.length > 0) {
        setCategory(finalCats[0]);
      }
    } catch {
      serverAvailable.current = false;
    } finally {
      isLoaded.current = true;
    }
  }, []);

  // ── Initial Load ──────────────────────────────────────────────────────────
  useEffect(() => {
    isLoaded.current = true;

    const local = loadFromLocalStorage();
    const restored = applyRoutineRestore(local.tasks);
    if (restored.length > 0 || local.categories.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTasks(restored);
      setCategories(local.categories);
    }
    setDiscordWebhookUrl(local.discordWebhookUrl);
    setDiscordNotifyTime(local.discordNotifyTime);
    
    // Load custom work / break durations
    const savedWork = localStorage.getItem("focustodo_work_dur");
    const savedBreak = localStorage.getItem("focustodo_break_dur");
    let initialWorkMins = 25;
    if (savedWork) {
      const w = parseInt(savedWork, 10);
      if (!isNaN(w) && w > 0) {
        setWorkDuration(w);
        initialWorkMins = w;
      }
    }
    if (savedBreak) {
      const b = parseInt(savedBreak, 10);
      if (!isNaN(b) && b > 0) {
        setBreakDuration(b);
      }
    }
    setTimerSeconds(initialWorkMins * 60);

    if (local.lastWrite > 0) lastLocalWrite.current = local.lastWrite;

    try {
      if (typeof window !== "undefined" && "Notification" in window) {
        setNotifPermission(Notification.permission);
      }
    } catch { /* ignore */ }

    // Force immediate server fetch on load by resetting the debounce timestamp.
    // This ensures the server (source of truth) always overrides stale localStorage
    // even when the user switches devices.
    lastLocalWrite.current = 0;
    fetchState();
    const syncInterval = setInterval(fetchState, 5000);
    return () => clearInterval(syncInterval);
  }, [fetchState]);

  // ── Pomodoro Timer Logic ──────────────────────────────────────────────────
  const updateWorkDuration = (mins: number) => {
    const val = Math.min(180, Math.max(0, mins));
    setWorkDuration(val);
    localStorage.setItem("focustodo_work_dur", String(val));
    if (!timerRunning && timerMode === "work") {
      setTimerSeconds(val * 60);
    }
  };

  const updateBreakDuration = (mins: number) => {
    const val = Math.min(60, Math.max(0, mins));
    setBreakDuration(val);
    localStorage.setItem("focustodo_break_dur", String(val));
    if (!timerRunning && timerMode === "break") {
      setTimerSeconds(val * 60);
    }
  };

  const handleWorkDurationBlur = () => {
    if (!workDuration || workDuration < 1) {
      updateWorkDuration(25);
    }
  };

  const handleBreakDurationBlur = () => {
    if (!breakDuration || breakDuration < 1) {
      updateBreakDuration(5);
    }
  };

  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((s) => {
          if (s <= 1) {
            // Timer finished
            setTimerRunning(false);
            const isWork = timerMode === "work";
            setTimerMode(isWork ? "break" : "work");
            
            const wDur = workDuration || 25;
            const bDur = breakDuration || 5;
            const nextSeconds = isWork ? bDur * 60 : wDur * 60;

            setTimerSeconds(nextSeconds);
            if (isWork) setTimerCycles((c) => c + 1);

            // Celebration confetti for finishing a work session
            if (isWork) {
              confetti({ particleCount: 80, spread: 60, origin: { y: 0.5 }, colors: ["#818cf8", "#34d399", "#fb923c"] });
            }
            try {
              new Notification("FocusTodo", {
                body: isWork 
                  ? `🎉 ${wDur}分集中完了！${bDur}分休憩しましょう。` 
                  : "⏰ 休憩終了！次のセッションを始めましょう。",
              });
            } catch { /* no notification permission */ }
            return nextSeconds;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning, timerMode, workDuration, breakDuration]);

  const resetTimer = () => {
    setTimerRunning(false);
    setTimerMode("work");
    setTimerSeconds((workDuration || 25) * 60);
  };

  const timerMinutes = Math.floor(timerSeconds / 60);
  const timerSecs = timerSeconds % 60;
  const timerProgress = timerMode === "work"
    ? 1 - timerSeconds / ((workDuration || 25) * 60)
    : 1 - timerSeconds / ((breakDuration || 5) * 60);

  // ── Reminder Notifications ────────────────────────────────────────────────
  useEffect(() => {
    const checkReminders = () => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const now = new Date();
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const updatedTasks = safeTasks.map((task) => {
        if (!task || task.completed || task.notified || !task.dueDate) return task;
        const [y, mo, d] = task.dueDate.split("-").map(Number);
        const [h, m] = task.dueTime ? task.dueTime.split(":").map(Number) : [9, 0];
        const deadline = new Date(y, mo - 1, d, h, m);
        const diff = deadline.getTime() - now.getTime();
        if (diff > 0 && diff <= 15 * 60 * 1000) {
          try { new Notification("FocusTodo リマインダー", { body: `「${task.text}」の締切が15分後です！` }); } catch { /* ignore */ }
          return { ...task, notified: true };
        }
        return task;
      });
      const hasUpdates = updatedTasks.some((t, i) => t !== safeTasks[i]);
      if (hasUpdates) updateState(updatedTasks as Task[], categories);
    };
    const id = setInterval(checkReminders, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, categories]);

  // ── Frustration Prediction Alert ──────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded.current || tasks.length === 0) return;
    
    // Check risk on client side only once per session
    if (typeof window !== "undefined" && !sessionStorage.getItem("frustration_alert_shown")) {
      let maxRisk = 0;
      const now = new Date();
      const [bedH] = averageBedtime.split(":").map(Number);
      const isLate = now.getHours() >= (bedH - 1 < 0 ? 23 : bedH - 1) || now.getHours() < 4;

      tasks.forEach(t => {
        if (t.completed) return;
        let risk = 0;
        if (disciplineScore < 50) risk += 10;
        if (t.estimatedMinutes && t.estimatedMinutes >= 60) risk += 20;
        const daysOld = (now.getTime() - t.createdAt) / (1000 * 60 * 60 * 24);
        if (daysOld > 3) risk += 30;
        if (isLate) risk += 40;

        if (risk > maxRisk) maxRisk = risk;
      });

      if (maxRisk >= 70) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setToastMessage("⚠️ 挫折リスクが高まっています。今日は軽めのタスク1つにして、早く寝ませんか？");
        sessionStorage.setItem("frustration_alert_shown", "true");
        setTimeout(() => setToastMessage(null), 8000);
      }
    }
  }, [tasks, disciplineScore, averageBedtime]);

  // ── Save ──────────────────────────────────────────────────────────────────
  async function saveStateToServer(
    updatedTasks: Task[], updatedCategories: string[], 
    dw?: string, dt?: string, disc?: number, bed?: string, vel?: number
  ) {
    lastLocalWrite.current = Date.now();
    const webhook = dw !== undefined ? dw : discordWebhookUrl;
    const notifyTime = dt !== undefined ? dt : discordNotifyTime;
    const finalDisc = disc !== undefined ? disc : disciplineScore;
    const finalBed = bed !== undefined ? bed : averageBedtime;
    const finalVel = vel !== undefined ? vel : taskVelocityPerHour;
    
    saveToLocalStorage(updatedTasks, updatedCategories, webhook, notifyTime, finalDisc, finalBed, finalVel);
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          tasks: updatedTasks, 
          categories: updatedCategories,
          discordWebhookUrl: webhook,
          discordNotifyTime: notifyTime,
          disciplineScore: finalDisc,
          averageBedtime: finalBed,
          taskVelocityPerHour: finalVel
        }),
      });
    } catch { /* localStorage already saved */ }
  };

  function updateState(
    newTasks: Task[], newCategories: string[], 
    dw?: string, dt?: string, disc?: number, bed?: string, vel?: number
  ) {
    setTasks(newTasks);
    setCategories(newCategories);
    if (dw !== undefined) setDiscordWebhookUrl(dw);
    if (dt !== undefined) setDiscordNotifyTime(dt);
    if (disc !== undefined) setDisciplineScore(disc);
    if (bed !== undefined) setAverageBedtime(bed);
    if (vel !== undefined) setTaskVelocityPerHour(vel);
    saveStateToServer(newTasks, newCategories, dw, dt, disc, bed, vel);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedText = inputText.trim();
    if (!trimmedText) return;
    const newTask: Task = {
      id: Date.now().toString(),
      text: trimmedText,
      description: description.trim() || undefined,
      completed: false,
      category,
      priority,
      isRoutine,
      startDate: startDate || undefined,
      dueDate: dueDate || undefined,
      dueTime: dueTime || undefined,
      notified: false,
      createdAt: Date.now(),
    };

    // ── Auto-sync to Google Calendar (only if signed in + due date set) ──
    if (gcalEnabled && dueDate) {
      try {
        const res = await fetch("/api/google-calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: newTask }),
        });
        if (res.ok) {
          const { eventId } = await res.json();
          newTask.gcalEventId = eventId;
        }
      } catch { /* silent — task still added without gcal sync */ }
    }

    updateState([newTask, ...tasks], categories);

    // ── Discord Real-time Notification ──
    if (discordWebhookUrl) {
      fetch("/api/discord/notify-added", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: discordWebhookUrl, task: newTask }),
      }).catch(err => console.error("Discord notifications addition failed:", err));
    }

    setInputText("");
    setDescription("");
    setStartDate("");
    setDueDate("");
    setDueTime("");
    setPriority("medium");
    setIsRoutine(false);
    setShowOptions(false);
    // iOS: blur any focused input to dismiss keyboard and reset zoom
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const handleToggleComplete = async (id: string) => {
    const task = tasks.find((t) => t.id === id);
    const willComplete = task && !task.completed;

    let updated = tasks.map((t) => {
      if (t.id !== id) return t;
      const newCompleted = !t.completed;
      return {
        ...t,
        completed: newCompleted,
        lastRoutineDate: newCompleted && t.isRoutine ? todayISO() : t.lastRoutineDate,
      };
    });

    if (willComplete && task?.parentId) {
      // Cascade completion to parents if all their children are completed
      let currentParentId: string | undefined = task.parentId;
      while (currentParentId) {
        const pId: string = currentParentId;
        const parent = updated.find(t => t.id === pId);
        if (!parent || parent.completed) break;

        const children = updated.filter(t => t.parentId === pId);
        const allCompleted = children.length > 0 && children.every(c => c.completed);
        
        if (allCompleted) {
          updated = updated.map(t => t.id === pId ? { ...t, completed: true, lastRoutineDate: t.isRoutine ? todayISO() : t.lastRoutineDate } : t);
          currentParentId = parent.parentId;
        } else {
          break;
        }
      }
    }
    updateState(updated, categories);

    // ── Auto-delete Google Calendar event on completion ──
    if (willComplete && gcalEnabled && task?.gcalEventId) {
      try {
        await fetch("/api/google-calendar", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: task.gcalEventId }),
        });
      } catch { /* silent */ }
    }

    // 🎉 Confetti on completion
    if (willComplete) {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#818cf8", "#34d399", "#fb923c", "#f87171", "#38bdf8", "#c084fc"],
        scalar: 1.1,
      });
    }
  };

  const handleDeleteTask = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateState(tasks.filter((t) => t.id !== id), categories);
    if (expandedTaskId === id) setExpandedTaskId(null);
  };

  const handleClearCompleted = () => {
    updateState(tasks.filter((t) => !t.completed), categories);
    setExpandedTaskId(null);
  };

  const handleAddCategory = (e: React.MouseEvent) => {
    e.preventDefault();
    const trimmedCat = newCatText.trim();
    if (!trimmedCat) return;
    if (categories.includes(trimmedCat)) { setCategory(trimmedCat); setNewCatText(""); setShowNewCatInput(false); return; }
    const updatedCats = [...categories, trimmedCat];
    setCategory(trimmedCat);
    updateState(tasks, updatedCats);
    setNewCatText("");
    setShowNewCatInput(false);
  };

  const handleDeleteCategory = (catToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (categories.length <= 1) return;
    const updatedCats = categories.filter((c) => c !== catToDelete);
    if (category === catToDelete) setCategory(updatedCats[0]);
    updateState(tasks, updatedCats);
  };

  const requestNotificationPermission = async () => {
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
      if (perm === "granted") new Notification("FocusTodo", { body: "リマインダー通知が有効になりました！" });
    } catch { /* ignore */ }
  };

  // ── Task Edit Handlers ────────────────────────────────────────────────────
  const handleOpenEdit = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTask(task);
    setEditParentId(task.parentId || "");
    setEditText(task.text);
    setEditDescription(task.description || "");
    setEditCategory(task.category);
    setEditPriority(task.priority ?? "medium");
    setEditStartDate(task.startDate || "");
    setEditDueDate(task.dueDate || "");
    setEditDueTime(task.dueTime || "");
    setEditIsRoutine(task.isRoutine);
    setEditEstimatedMinutes(task.estimatedMinutes || "");
    setEditNotToDosText(task.notToDos?.map(n => n.text).join("\n") || "");
    setEditPenaltyType(task.penalty?.type || "none");
    setEditPenaltyTarget(task.penalty?.targetApp || "");
  };

  const handleSaveEdit = () => {
    if (!editingTask) return;
    const trimmed = editText.trim();
    if (!trimmed) return;
    const newNotToDos = editNotToDosText.trim() ? editNotToDosText.split("\n").filter(t => t.trim()).map((t, i) => {
      const existing = editingTask.notToDos?.find(n => n.text === t.trim());
      return existing || { id: Date.now().toString() + i, text: t.trim() };
    }) : undefined;
    
    const newPenalty = editPenaltyType !== "none" ? {
      type: editPenaltyType as "screen_time_lock" | "other",
      targetApp: editPenaltyTarget,
      status: editingTask.penalty?.status || "active" as const
    } : undefined;

    const isNew = !tasks.some(t => t.id === editingTask.id);
    const newTaskObj = {
      ...editingTask,
      text: trimmed,
      parentId: editParentId || undefined,
      description: editDescription.trim() || undefined,
      category: editCategory,
      priority: editPriority,
      startDate: editStartDate || undefined,
      dueDate: editDueDate || undefined,
      dueTime: editDueTime || undefined,
      isRoutine: editIsRoutine,
      estimatedMinutes: editEstimatedMinutes !== "" ? Number(editEstimatedMinutes) : undefined,
      notToDos: newNotToDos,
      penalty: newPenalty,
      notified: false,
    };
    
    let updated;
    if (isNew) {
      updated = [newTaskObj, ...tasks];
    } else {
      updated = tasks.map(t => t.id === editingTask.id ? newTaskObj : t);
    }
    updateState(updated, categories);
    setEditingTask(null);
    // iOS: reset zoom after closing modal
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  // ── Downgrade Features (AI) ───────────────────────────────────────
  const handleSuggestDowngrade = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const targetTask = tasks.find(t => t.id === taskId);
    if (!targetTask) return;

    // ローディング状態を設定
    const loading = tasks.map(t =>
      t.id === taskId ? { ...t, downgradeStatus: "loading" as const } : t
    );
    updateState(loading, categories);

    try {
      const res = await fetch("/api/ai/downgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskText: targetTask.text }),
      });

      if (!res.ok) {
        let errDetail = `API error: ${res.status}`;
        try {
          const errData = await res.json();
          if (errData && errData.error) {
            errDetail = `${errDetail} - ${errData.error}`;
          }
        } catch { /* ignore */ }
        throw new Error(errDetail);
      }
      const data = await res.json();
      const suggestions: string[] = Array.isArray(data.suggestions) ? data.suggestions : [];

      const updated = tasks.map(t =>
        t.id === taskId
          ? { ...t, downgradeStatus: "suggested" as const, downgradeSuggestions: suggestions }
          : t
      );
      updateState(updated, categories);
    } catch (error) {
      console.error("Failed to suggest downgrade via AI API:", error);
      // エラー時はフォールバック提案を使用
      const fallback = [
        "1分だけ関連するファイルを開く",
        "最初の1行だけ書く",
        "必要な資料を手元に出す",
      ];
      const updated = tasks.map(t =>
        t.id === taskId
          ? { ...t, downgradeStatus: "suggested" as const, downgradeSuggestions: fallback }
          : t
      );
      updateState(updated, categories);
    }
  };

  const handleAcceptDowngrade = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetTask = tasks.find(t => t.id === taskId);
    if (!targetTask || !targetTask.downgradeSuggestions) return;
    
    // Create new subtasks
    const newTasks: Task[] = targetTask.downgradeSuggestions.map((s, idx) => ({
      id: Date.now().toString() + idx,
      text: `[極小ステップ] ${s}`,
      category: targetTask.category,
      priority: "medium", // Low barrier
      isRoutine: false,
      completed: false,
      parentTaskId: targetTask.id,
      createdAt: Date.now(),
    }));

    // Update parent task to "accepted"
    const updated = tasks.map(t => t.id === taskId ? { ...t, downgradeStatus: "accepted" as const } : t);
    updateState([...newTasks, ...updated], categories);
  };

  // ── Priority Accordion ────────────────────────────────────────────────────
  const togglePriorityCollapse = (p: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedPriorities((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };



  // ── Google Calendar URL ───────────────────────────────────────────────────
  const getGoogleCalendarUrl = (task: Task) => {
    const title = encodeURIComponent(task.text);
    let detailsText = task.description || "";
    if (task.startDate) detailsText = `[開始日] ${task.startDate}\n\n${detailsText}`;
    detailsText = `${detailsText}\n\n---\nCreated via FocusTodo`;
    const details = encodeURIComponent(detailsText);

    const fmt = (iso: string) => iso.replace(/-/g, "");
    const fmtNextDay = (iso: string) => {
      const [y, mo, d] = iso.split("-").map(Number);
      const next = new Date(y, mo - 1, d + 1);
      return `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, "0")}${String(next.getDate()).padStart(2, "0")}`;
    };
    const todayStr = () => {
      const now = new Date();
      return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    };

    const startBase = task.startDate ? fmt(task.startDate) : todayStr();
    let startStr: string;
    let endStr: string;

    if (task.dueDate && task.dueTime) {
      startStr = `${startBase}T000000`;
      endStr = `${fmt(task.dueDate)}T${task.dueTime.replace(":", "")}00`;
    } else if (task.dueDate) {
      startStr = startBase;
      endStr = fmtNextDay(task.dueDate);
    } else {
      startStr = startBase;
      endStr = startBase;
    }

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&dates=${startStr}/${endStr}`;
  };

  // ── Computed ──────────────────────────────────────────────────────────────
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeCategories = Array.isArray(categories) ? categories : ["勉強用", "その他"];

  const filteredTasks = safeTasks
    .filter((task) => {
      if (!task) return false;
      const matchesStatus =
        statusFilter === "active" ? !task.completed :
        statusFilter === "completed" ? task.completed : true;
      const matchesCat = categoryFilter === "all" ? true : task.category === categoryFilter;
      return matchesStatus && matchesCat;
    })
    .sort((a, b) => {
      // Sort by priority: high → medium → low, then by createdAt
      const order = { high: 0, medium: 1, low: 2 };
      const pa = order[a.priority ?? "medium"];
      const pb = order[b.priority ?? "medium"];
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });

  const getDateStatus = (dueDateStr?: string, dueTimeStr?: string, completed?: boolean) => {
    if (!dueDateStr || completed) return { label: "", type: "normal" };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [year, month, day] = dueDateStr.split("-").map(Number);
    const [hour, min] = dueTimeStr ? dueTimeStr.split(":").map(Number) : [23, 59];
    const deadline = new Date(year, month - 1, day, hour, min, 0);
    const deadlineDateOnly = new Date(year, month - 1, day);
    const formatted = `${month}/${day}${dueTimeStr ? ` ${dueTimeStr}` : ""}`;
    if (now > deadline) return { label: `期限切れ (${formatted})`, type: "danger" };
    if (today.getTime() === deadlineDateOnly.getTime()) return { label: `本日締切 (${formatted})`, type: "warning" };
    return { label: `締切: ${formatted}`, type: "normal" };
  };

  const activeTasksCount = safeTasks.filter((t) => t && !t.completed).length;
  const completedTasksCount = safeTasks.length - activeTasksCount;

  // ── Priority dot helper ───────────────────────────────────────────────────
  const PriorityDot = ({ p }: { p: Task["priority"] }) => (
    <span className={`priority-dot priority-dot--${p}`} title={`優先度: ${PRIORITY_LABEL[p]}`} />
  );

  // ── Priority groups split ──
  const highPriorityTasks = filteredTasks.filter((task) => (task.priority ?? "medium") === "high");
  const mediumPriorityTasks = filteredTasks.filter((task) => (task.priority ?? "medium") === "medium");
  const lowPriorityTasks = filteredTasks.filter((task) => (task.priority ?? "medium") === "low");


  const renderTaskNode = (task: Task, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedTaskId === task.id;
    const dateStatus = getDateStatus(task.dueDate, task.dueTime, task.completed);
    const children = safeTasks.filter((t) => t && t.parentId === task.id);
    const hasChildren = children.length > 0;
    const isTreeCollapsed = collapsedTreeIds.has(task.id);
    
    let progressText = "";
    if (hasChildren) {
      const completedChildren = children.filter(c => c && c.completed).length;
      progressText = `${completedChildren}/${children.length}`;
    }

    return (
      <React.Fragment key={task.id}>
        <li
          className={`todo-item priority-border--${task.priority ?? "medium"} ${task.completed ? "completed" : ""}`}
          onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
          id={`task-item-${task.id}`}
        >
          {/* We add a left border guide for nested items */}
          <div className="todo-item-main-row" style={{ paddingLeft: `${depth * 28}px`, position: "relative" }}>
            {depth > 0 && (
              <div style={{ position: "absolute", left: `${(depth - 1) * 28 + 14}px`, top: 0, bottom: 0, width: "2px", background: "var(--border)", opacity: 0.5 }} />
            )}
            
            {hasChildren ? (
              <button 
                onClick={(e) => toggleTreeCollapse(task.id, e)} 
                className="tree-toggle-btn" 
                style={{ 
                  background: "transparent", border: "none", color: "var(--text-muted)", 
                  cursor: "pointer", padding: "0 8px 0 0", fontSize: "12px", 
                  display: "flex", alignItems: "center", justifyContent: "center", 
                  transform: isTreeCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.2s" 
                }}
              >
                ▶︎
              </button>
            ) : (
              <div style={{ width: "20px" }} />
            )}

            <div className="todo-item-left">
              {/* Checkbox */}
              <div className="custom-checkbox" onClick={(e) => { e.stopPropagation(); handleToggleComplete(task.id); }}>
                <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
              </div>

              <div className="todo-content-wrapper">
                <div className="todo-text-row">
                  {/* Priority dot */}
                  <PriorityDot p={task.priority ?? "medium"} />
                  {/* Category badge */}
                  <span className={`cat-badge ${task.category === "勉強用" ? "study" : "other"}`}>{task.category}</span>
                  <span className="todo-text">{task.text}</span>
                  {hasChildren && (
                    <span style={{ fontSize: "11px", background: "var(--bg)", border: "1px solid var(--border)", padding: "2px 6px", borderRadius: "10px", marginLeft: "6px", color: "var(--text-muted)", fontWeight: "bold" }}>
                      {progressText}
                    </span>
                  )}
                  {/* Routine indicator */}
                  {task.isRoutine && <span title="毎日ルーティン" style={{ fontSize: "0.75rem" }}>🔁</span>}
                  {/* Memo indicator */}
                  {task.description && (
                    <span className="has-desc-indicator" title="詳細メモあり">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    </span>
                  )}
                </div>
                {(task.startDate || dateStatus.label) && (
                  <div className="dates-row">
                    {task.startDate && (
                      <span className="date-badge">
                        <svg viewBox="0 0 24 24" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                        開始: {task.startDate.substring(5).replace("-", "/")}
                      </span>
                    )}
                    {dateStatus.label && (
                      <span className={`date-badge ${dateStatus.type}`}>
                        <svg viewBox="0 0 24 24" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        {dateStatus.label}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="task-action-btns">
              {/* Suggest Downgrade button */}
              {!task.completed && task.downgradeStatus !== "accepted" && (
                <button
                  type="button"
                  className="edit-btn"
                  onClick={(e) => handleSuggestDowngrade(task.id, e)}
                  title="ハードルが高い？ (AIが極小ステップを提案)"
                  style={{ fontSize: "16px", paddingBottom: "2px", opacity: task.downgradeStatus === "loading" ? 0.5 : 1 }}
                  disabled={task.downgradeStatus === "loading"}
                >
                  {task.downgradeStatus === "loading" ? "⏳" : "😫"}
                </button>
              )}
                            {/* Map View button */}
              <button
                type="button"
                className="edit-btn"
                onClick={(e) => { e.stopPropagation(); setMapRootTaskId(task.id); }}
                title="ツリーマップを表示"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 3v18" />
                  <path d="M9 12h12" />
                </svg>
              </button>
              {/* Edit button */}
              <button
                type="button"
                className="edit-btn"
                onClick={(e) => handleOpenEdit(task, e)}
                title="タスクを編集"
                id={`task-edit-btn-${task.id}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              {/* Delete button */}
              <button type="button" className="delete-btn" onClick={(e) => handleDeleteTask(task.id, e)} title="タスクを削除" id={`task-delete-btn-${task.id}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Downgrade Loading UI */}
          {!task.completed && task.downgradeStatus === "loading" && (
            <div onClick={(e) => e.stopPropagation()} style={{
              background: "var(--bg)", margin: "0 12px 12px 12px", padding: "12px", borderRadius: "8px",
              border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "8px", color: "var(--primary)"
            }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span>
              <span style={{ fontSize: "14px", fontWeight: 500 }}>AIが極小ステップを考えています...</span>
            </div>
          )}

          {/* Downgrade Suggestions UI */}
          {!task.completed && task.downgradeStatus === "suggested" && task.downgradeSuggestions && (
            <div className="downgrade-suggestion-box" onClick={(e) => e.stopPropagation()} style={{
              background: "var(--bg)", margin: "0 12px 12px 12px", padding: "12px", borderRadius: "8px", border: "1px solid var(--border)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", color: "var(--primary)" }}>
                <span>💡</span>
                <span style={{ fontWeight: 600, fontSize: "14px" }}>AI提案: ハードルを下げてみませんか？</span>
              </div>
              <ul style={{ margin: "0 0 12px 0", paddingLeft: "20px", fontSize: "14px", color: "var(--text)" }}>
                {task.downgradeSuggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="modal-save-btn"
                  style={{ padding: "6px 12px", fontSize: "13px", height: "auto" }}
                  onClick={(e) => handleAcceptDowngrade(task.id, e)}
                >
                  提案を受け入れる
                </button>
                <button
                  type="button"
                  className="modal-cancel-btn"
                  style={{ padding: "6px 12px", fontSize: "13px", height: "auto" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const updated = tasks.map(t => t.id === task.id ? { ...t, downgradeStatus: "none" as const } : t);
                    updateState(updated, categories);
                  }}
                >
                  閉じる
                </button>
              </div>
            </div>
          )}

          {/* Expanded panel */}
          {isExpanded && (
            <div className="todo-expanded-panel" onClick={(e) => e.stopPropagation()}>
              <div className="todo-desc-label">具体的な詳細内容（メモ）</div>
              <div className="todo-desc-text">{task.description || "詳細メモはありません。"}</div>

              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px", flexWrap: "wrap" }}>
                <a href={getGoogleCalendarUrl(task)} target="_blank" rel="noopener noreferrer" className="calendar-sync-btn">
                  <svg viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                    <circle cx="12" cy="16" r="2" />
                  </svg>
                  カレンダーに登録
                </a>
                
                <button 
                  onClick={() => {
                    // Open New Task input with this task as parent
                    setEditParentId(task.id);
                    // We can reuse edit modal, but let's just create a new task
                    const tempTask = {
                      id: Date.now().toString(),
                      text: "新しい子タスク",
                      completed: false,
                      category: task.category,
                      priority: task.priority,
                      isRoutine: false,
                      parentId: task.id,
                      createdAt: Date.now()
                    };
                    setEditingTask(tempTask as Task);
                    setEditText(tempTask.text);
                    setEditDescription("");
                    setEditCategory(tempTask.category);
                    setEditPriority(tempTask.priority);
                    setEditStartDate("");
                    setEditDueDate("");
                    setEditDueTime("");
                    setEditIsRoutine(false);
                  }}
                  className="calendar-sync-btn" 
                  style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  子タスクを追加
                </button>
              </div>
            </div>
          )}
        </li>
        {/* Render Children Recursively */}
        {!isTreeCollapsed && hasChildren && children.map(child => renderTaskNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  const renderPrioritySection = (
    priority: "high" | "medium" | "low",
    label: string,
    colorClass: string,
    sectionTasks: Task[]
  ) => {
    const isCollapsed = collapsedPriorities.has(priority);
    return (
      <div className={`priority-section priority-section--${priority}`} key={priority}>
        <div
          className="priority-section-header priority-section-header--clickable"
          onClick={(e) => togglePriorityCollapse(priority, e)}
        >
          <div className="priority-section-title-wrap">
            <span className={`priority-section-dot priority-section-dot--${priority}`} />
            <h3 className="priority-section-title">{label}</h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="priority-section-count">{sectionTasks.length}</span>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{
                color: "var(--text-muted)",
                transition: "transform 0.25s ease",
                transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                flexShrink: 0,
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        {!isCollapsed && (
          <ul className="todo-list">
            {sectionTasks.length > 0 ? (
              sectionTasks.filter(t => !t.parentId).map(task => renderTaskNode(task))
            ) : (
              <div className="priority-empty-state">
                <p>この優先度のタスクはありません。</p>
              </div>
            )}
          </ul>
        )}
      </div>
    );
  };


  // ── Render ────────────────────────────────────────────────────────────────

  // Compute active Not-ToDos for focus mode
  const activeNotToDos = timerRunning && timerMode === "work"
    ? tasks.filter(t => !t.completed && t.notToDos?.length).flatMap(t => t.notToDos!)
    : [];

  return (
    <>
    <div className="app-container">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast-alert" style={{
          position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
          background: "var(--danger)", color: "white", padding: "12px 24px",
          borderRadius: "8px", zIndex: 10000, boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          animation: "modalFadeIn 0.3s ease", fontWeight: 500, fontSize: "15px",
          display: "flex", alignItems: "center", gap: "8px"
        }}>
          {toastMessage}
          <button 
            type="button" 
            onClick={() => setToastMessage(null)}
            style={{ background: "transparent", border: "none", color: "white", cursor: "pointer", marginLeft: "8px", fontSize: "16px" }}
          >×</button>
        </div>
      )}

      {/* Header */}
      <header className="header">
        <div className="header-top">
          <div>
            <h1>FocusTodo</h1>
            <p>Your synchronized personal space</p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {/* Discord Settings Button */}
            <button
              type="button"
              className="settings-toggle-btn"
              onClick={() => setShowSettingsModal(true)}
              title="設定を開く"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>設定</span>
            </button>

            {/* User info + Sign out */}
            {session && (
              <div className="header-user-info">
                {session.user?.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={session.user.image} alt={session.user.name ?? ""} className="gcal-avatar" title={session.user.name ?? session.user.email ?? ""} />
                )}
                <button
                  type="button"
                  className="signout-btn"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  title="ログアウト"
                >
                  ログアウト
                </button>
              </div>
            )}

          </div>
        </div>
      </header>

      {/* Notification banner */}
      {notifPermission === "default" && (
        <div className="notif-banner">
          <span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            リマインダー通知を有効にしますか？
          </span>
          <button type="button" className="notif-btn" onClick={requestNotificationPermission}>通知を許可</button>
        </div>
      )}

      {/* Behavioral Economics: Not-ToDos Banner during Focus Mode */}
      {activeNotToDos.length > 0 && (
        <div className="not-todo-banner" style={{
          background: "linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.05))",
          borderLeft: "4px solid var(--danger)",
          padding: "16px",
          borderRadius: "8px",
          marginBottom: "16px",
          animation: "modalFadeIn 0.5s ease"
        }}>
          <h3 style={{ margin: "0 0 8px 0", color: "var(--danger)", fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            🚫 集中モード中: これだけはやらない！
          </h3>
          <ul style={{ margin: 0, paddingLeft: "24px", color: "var(--text-muted)", fontSize: "15px" }}>
            {activeNotToDos.map((nt, idx) => (
              <li key={nt.id || idx} style={{ marginBottom: "4px" }}>{nt.text}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 2-column grid */}

      <div className="app-grid">

        {/* ── Left Column ── */}
        <div className="form-column">

          {/* ── Pomodoro Timer ── */}
          <div className="pomodoro-card">
            <div
              className="pomodoro-header pomodoro-header--clickable"
              onClick={() => setTimerOpen(!timerOpen)}
              title={timerOpen ? "タイマーを折りたたむ" : "タイマーを開く"}
            >
              <span className="pomodoro-title">
                {timerMode === "work" ? "🍅 集中タイマー" : "☕ 休憩タイム"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {!timerOpen && (
                  <span className="pomodoro-collapsed-time">
                    {String(timerMinutes).padStart(2, "0")}:{String(timerSecs).padStart(2, "0")}
                    {timerRunning && <span className="pomodoro-running-dot" />}
                  </span>
                )}
                <span className="pomodoro-cycles">完了: {timerCycles}セット</span>
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                  style={{
                    color: "var(--text-muted)",
                    transition: "transform 0.3s ease",
                    transform: timerOpen ? "rotate(0deg)" : "rotate(-90deg)",
                    flexShrink: 0,
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>


            {timerOpen && (
              <>
                {/* Circular progress ring */}
                <div className="pomodoro-ring-wrap">
                  <svg className="pomodoro-ring" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="44" className="pomodoro-ring-bg" />
                    <circle
                      cx="50" cy="50" r="44"
                      className={`pomodoro-ring-fg pomodoro-ring-fg--${timerMode}`}
                      strokeDasharray={`${2 * Math.PI * 44}`}
                      strokeDashoffset={`${2 * Math.PI * 44 * (1 - timerProgress)}`}
                    />
                  </svg>
                  <div className="pomodoro-time">
                    {String(timerMinutes).padStart(2, "0")}:{String(timerSecs).padStart(2, "0")}
                  </div>
                </div>

                {/* Duration Settings */}
                <div className={`timer-settings ${timerRunning ? "disabled" : ""}`}>
                  <div className="timer-settings-group">
                    <span className="timer-settings-label">🎯 集中時間:</span>
                    <div className="timer-presets-row">
                      {[15, 25, 50].map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          className={`timer-preset-btn timer-preset-btn--work ${workDuration === mins ? "active" : ""}`}
                          onClick={() => updateWorkDuration(mins)}
                          disabled={timerRunning}
                        >
                          {mins}分
                        </button>
                      ))}
                      <div className="timer-custom-input-wrapper">
                        <input
                          type="number"
                          min="1"
                          max="180"
                          value={workDuration || ""}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            updateWorkDuration(isNaN(val) ? 0 : val);
                          }}
                          onBlur={handleWorkDurationBlur}
                          disabled={timerRunning}
                          className="timer-custom-input"
                          placeholder="カスタム"
                        />
                        <span className="timer-custom-unit">分</span>
                      </div>
                    </div>
                  </div>

                  <div className="timer-settings-group">
                    <span className="timer-settings-label">☕ 休憩時間:</span>
                    <div className="timer-presets-row">
                      {[5, 10, 15].map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          className={`timer-preset-btn timer-preset-btn--break ${breakDuration === mins ? "active" : ""}`}
                          onClick={() => updateBreakDuration(mins)}
                          disabled={timerRunning}
                        >
                          {mins}分
                        </button>
                      ))}
                      <div className="timer-custom-input-wrapper">
                        <input
                          type="number"
                          min="1"
                          max="60"
                          value={breakDuration || ""}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            updateBreakDuration(isNaN(val) ? 0 : val);
                          }}
                          onBlur={handleBreakDurationBlur}
                          disabled={timerRunning}
                          className="timer-custom-input"
                          placeholder="カスタム"
                        />
                        <span className="timer-custom-unit">分</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pomodoro-controls">
                  <button
                    type="button"
                    className={`pomodoro-btn pomodoro-btn--main ${timerRunning ? "running" : ""}`}
                    onClick={() => setTimerRunning(!timerRunning)}
                  >
                    {timerRunning ? "⏸ 一時停止" : "▶ スタート"}
                  </button>
                  <button type="button" className="pomodoro-btn pomodoro-btn--reset" onClick={resetTimer}>
                    ↩ リセット
                  </button>
                </div>
              </>
            )}
          </div>


          {/* ── Add Task Form ── */}
          <form onSubmit={handleAddTask} className="todo-form">
            <div className="input-row">
              <div className="input-wrapper">
                <input
                  type="text"
                  className="todo-input"
                  placeholder="タスクのタイトルを入力..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  maxLength={100}
                  id="todo-task-input"
                  required
                />
              </div>
              <button type="submit" className="add-button" id="todo-add-btn">追加</button>
            </div>

            {/* Priority selector */}
            <div className="priority-selector">
              {(["high", "medium", "low"] as Task["priority"][]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`priority-btn priority-btn--${p} ${priority === p ? "selected" : ""}`}
                  onClick={() => setPriority(p)}
                >
                  <span className={`priority-dot priority-dot--${p}`} />
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>

            {/* Options toggle */}
            <button
              type="button"
              className={`toggle-options-btn ${showOptions ? "expanded" : ""}`}
              onClick={() => setShowOptions(!showOptions)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {showOptions ? "詳細設定を閉じる" : "カテゴリー・日時・詳細を入力"}
            </button>

            {showOptions && (
              <div className="form-options-panel">
                {/* Category */}
                <div className="option-group">
                  <label>カテゴリー</label>
                  <div className="category-select-container" style={{ flexWrap: "wrap", rowGap: "8px" }}>
                    {safeCategories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={`category-select-btn ${category === cat ? "selected study" : ""}`}
                        onClick={() => setCategory(cat)}
                        style={{ position: "relative", paddingRight: safeCategories.length > 1 ? "24px" : "14px" }}
                      >
                        {cat}
                        {safeCategories.length > 1 && (
                          <span
                            onClick={(e) => handleDeleteCategory(cat, e)}
                            style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", fontSize: "10px", opacity: 0.5, cursor: "pointer" }}
                            title="カテゴリーを削除"
                          >✕</span>
                        )}
                      </button>
                    ))}
                    {!showNewCatInput ? (
                      <button
                        type="button"
                        className="category-select-btn"
                        style={{ background: "rgba(129,140,248,.15)", borderColor: "rgba(129,140,248,.3)", color: "var(--accent-primary)" }}
                        onClick={() => setShowNewCatInput(true)}
                      >➕ 追加</button>
                    ) : (
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input
                          type="text" className="date-input"
                          style={{ padding: "4px 8px", width: "120px", height: "30px" }}
                          placeholder="新しい名..." value={newCatText}
                          onChange={(e) => setNewCatText(e.target.value)} maxLength={15} autoFocus
                        />
                        <button type="button" className="add-button" style={{ height: "30px", padding: "0 10px", fontSize: "0.8rem", borderRadius: "8px" }} onClick={handleAddCategory}>追加</button>
                        <button type="button" className="category-select-btn" style={{ height: "30px", padding: "0 10px", borderRadius: "8px" }} onClick={() => setShowNewCatInput(false)}>キャンセル</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div className="option-group">
                  <label>具体的な詳細内容（メモ・詳細手順）</label>
                  <textarea className="todo-textarea" placeholder="具体的なタスクの手順や内容を入力してください..." value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
                </div>

                {/* Dates */}
                <div className="option-row">
                  <div className="option-group">
                    <label>開始日</label>
                    <input type="date" className="date-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="option-group">
                    <label>締切日時</label>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input type="date" className="date-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                      <input type="time" className="date-input" style={{ width: "80px" }} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                    </div>
                  </div>
                </div>

                {/* Routine toggle */}
                <label className="routine-toggle">
                  <input
                    type="checkbox"
                    checked={isRoutine}
                    onChange={(e) => setIsRoutine(e.target.checked)}
                    className="routine-checkbox"
                  />
                  <span className="routine-toggle-track">
                    <span className="routine-toggle-thumb" />
                  </span>
                  <span className="routine-label">
                    🔁 毎日繰り返す（翌日に自動復活）
                  </span>
                </label>
              </div>
            )}
          </form>
        </div>

        {/* ── Right Column ── */}
        <div className="list-column">
          {/* Filter controls */}
          <div className="controls-row">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="category-filter-tabs" style={{ flexWrap: "wrap", rowGap: "4px" }}>
                <button type="button" className={`cat-tab-btn ${categoryFilter === "all" ? "active all" : ""}`} onClick={() => setCategoryFilter("all")}>すべて</button>
                {safeCategories.map((cat) => (
                  <button key={cat} type="button" className={`cat-tab-btn ${categoryFilter === cat ? "active study" : ""}`} onClick={() => setCategoryFilter(cat)}>{cat}</button>
                ))}
              </div>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", flexShrink: 0 }}>同期中 🟢</span>
            </div>
            <div className="sub-controls-row">
              <span className="task-counter" id="active-count-label">
                {activeTasksCount > 0 ? `未完了: ${activeTasksCount}個` : "すべて完了！"}
              </span>
              <div className="filter-tabs">
                <button type="button" className={`tab-btn ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")} id="tab-all">すべて</button>
                <button type="button" className={`tab-btn ${statusFilter === "active" ? "active" : ""}`} onClick={() => setStatusFilter("active")} id="tab-active">未完了</button>
                <button type="button" className={`tab-btn ${statusFilter === "completed" ? "active" : ""}`} onClick={() => setStatusFilter("completed")} id="tab-completed">完了</button>
              </div>
            </div>
          </div>

          {/* Task list grouped by priority */}
          <div className="priority-groups-container" id="todo-task-list">
            {filteredTasks.length > 0 ? (
              <>
                {renderPrioritySection("high", "🔥 高（今日絶対）", "high", highPriorityTasks)}
                {renderPrioritySection("medium", "⚡ 中（お早めに）", "medium", mediumPriorityTasks)}
                {renderPrioritySection("low", "🌱 低（できれば）", "low", lowPriorityTasks)}
              </>
            ) : (
              <div className="empty-state" id="todo-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p>{categoryFilter === "all" ? "タスクがありません。新しく追加してみましょう！" : `「${categoryFilter}」のタスクはありません。`}</p>
              </div>
            )}
          </div>

          {completedTasksCount > 0 && (
            <div className="controls-row" style={{ borderBottom: "none", marginTop: "16px", paddingBottom: 0 }}>
              <span />
              <button type="button" className="clear-btn" onClick={handleClearCompleted} id="clear-completed-btn">完了したタスクを一括消去</button>
            </div>
          )}
        </div>
      </div>

      <footer className="footer-note">
        <p>© 2026 FocusTodo. Securely Connected.</p>
      </footer>

      {/* ── Task Edit Modal ── */}
      {editingTask && (
        <div className="modal-overlay" onClick={() => setEditingTask(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTask && !tasks.some(t => t.id === editingTask.id) ? "➕ 子タスクを追加" : "✏️ タスクを編集"}</h2>
              <button type="button" className="close-x-btn" onClick={() => setEditingTask(null)}>✕</button>
            </div>

            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px", maxHeight: "60vh", overflowY: "auto", paddingRight: "4px" }}>
              {/* Task name */}
              {/* Parent Task Selector */}
              <div className="settings-form-group">
                <label>親タスク</label>
                <select 
                  className="todo-input" 
                  style={{ fontSize: "0.95rem", height: "44px", padding: "0 12px", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "8px" }}
                  value={editParentId} 
                  onChange={(e) => setEditParentId(e.target.value)}
                >
                  <option value="">(なし - ルートタスク)</option>
                  {tasks.filter(t => t.id !== editingTask?.id && !t.completed).map(t => (
                    <option key={t.id} value={t.id}>{t.text}</option>
                  ))}
                </select>
              </div>

              <div className="settings-form-group">
                <label htmlFor="edit-task-title">タスク名</label>
                <input
                  type="text"
                  id="edit-task-title"
                  className="todo-input"
                  style={{ fontSize: "0.95rem", height: "44px" }}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  maxLength={100}
                  autoFocus
                />
              </div>

              {/* Priority */}
              <div className="settings-form-group">
                <label>優先度</label>
                <div className="priority-selector" style={{ marginTop: "4px" }}>
                  {(["high", "medium", "low"] as Task["priority"][]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`priority-btn priority-btn--${p} ${editPriority === p ? "selected" : ""}`}
                      onClick={() => setEditPriority(p)}
                    >
                      <span className={`priority-dot priority-dot--${p}`} />
                      {PRIORITY_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category */}
              <div className="settings-form-group">
                <label>カテゴリー</label>
                <div className="category-select-container" style={{ flexWrap: "wrap", gap: "8px", marginTop: "4px" }}>
                  {safeCategories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`category-select-btn ${editCategory === cat ? "selected study" : ""}`}
                      onClick={() => setEditCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="settings-form-group">
                <label htmlFor="edit-task-desc">詳細メモ</label>
                <textarea
                  id="edit-task-desc"
                  className="todo-textarea"
                  style={{ height: "80px" }}
                  placeholder="詳細・手順などを入力..."
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  maxLength={500}
                />
              </div>

              {/* Dates */}
              <div className="option-row">
                <div className="settings-form-group">
                  <label htmlFor="edit-start-date">開始日</label>
                  <input
                    type="date"
                    id="edit-start-date"
                    className="date-input"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                  />
                </div>
                <div className="settings-form-group">
                  <label htmlFor="edit-due-date">締切日</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      type="date"
                      id="edit-due-date"
                      className="date-input"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                    />
                    <input
                      type="time"
                      className="date-input"
                      style={{ width: "80px" }}
                      value={editDueTime}
                      onChange={(e) => setEditDueTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Behavioral Economics Features */}
              <div className="settings-form-group" style={{ marginTop: "8px" }}>
                <label>行動経済学・サポート設定</label>
                <div style={{ background: "var(--bg)", padding: "12px", borderRadius: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "14px", color: "var(--text)" }}>⏱ 推定時間（分）:</span>
                    <input 
                      type="number" 
                      className="todo-input"
                      style={{ width: "80px", height: "32px", fontSize: "14px" }}
                      min="1"
                      placeholder="例: 30"
                      value={editEstimatedMinutes}
                      onChange={(e) => setEditEstimatedMinutes(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "14px", color: "var(--text)" }}>🚫 集中時の Not-ToDo（1行1つ）:</span>
                    <textarea
                      className="todo-textarea"
                      style={{ height: "60px", fontSize: "14px" }}
                      placeholder="例: スマホを見ない&#10;YouTubeを開かない"
                      value={editNotToDosText}
                      onChange={(e) => setEditNotToDosText(e.target.value)}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "14px", color: "var(--text)" }}>⚡️ サボりペナルティ:</span>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <select 
                        className="todo-input" 
                        style={{ height: "32px", fontSize: "14px", flex: 1, padding: "0 8px" }}
                        value={editPenaltyType}
                        onChange={(e) => setEditPenaltyType(e.target.value as "none" | "screen_time_lock" | "other")}
                      >
                        <option value="none">なし</option>
                        <option value="screen_time_lock">アプリのロック (Mock)</option>
                        <option value="other">その他</option>
                      </select>
                      {editPenaltyType !== "none" && (
                        <input 
                          type="text" 
                          className="todo-input"
                          style={{ height: "32px", fontSize: "14px", flex: 1 }}
                          placeholder="対象アプリ / 罰則内容"
                          value={editPenaltyTarget}
                          onChange={(e) => setEditPenaltyTarget(e.target.value)}
                        />
                      )}
                    </div>
                  </div>

                </div>
              </div>

              {/* Routine toggle */}
              <label className="routine-toggle">
                <input
                  type="checkbox"
                  checked={editIsRoutine}
                  onChange={(e) => setEditIsRoutine(e.target.checked)}
                  className="routine-checkbox"
                />
                <span className="routine-toggle-track">
                  <span className="routine-toggle-thumb" />
                </span>
                <span className="routine-label">🔁 毎日繰り返す</span>
              </label>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="modal-save-btn"
                onClick={handleSaveEdit}
                disabled={!editText.trim()}
              >
                {editingTask && !tasks.some(t => t.id === editingTask.id) ? "タスクを追加" : "変更を保存"}
              </button>
              <button
                type="button"
                className="modal-cancel-btn"
                onClick={() => setEditingTask(null)}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings Modal (Glassmorphism) ── */}

      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => {
          const local = loadFromLocalStorage();
          setDiscordWebhookUrl(local.discordWebhookUrl);
          setDiscordNotifyTime(local.discordNotifyTime);
          setShowSettingsModal(false);
          setTestStatus(null);
        }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚙️ FocusTodo 設定</h2>
              <button type="button" className="close-x-btn" onClick={() => {
                const local = loadFromLocalStorage();
                setDiscordWebhookUrl(local.discordWebhookUrl);
                setDiscordNotifyTime(local.discordNotifyTime);
                setShowSettingsModal(false);
                setTestStatus(null);
              }}>✕</button>
            </div>
            
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div className="settings-section">
                <h3>🔔 Discord 通知機能</h3>
                <p className="settings-desc">
                  DiscordのWebhookと連携し、新しいタスクの追加時や、毎朝の本日締切タスクのサマリーを自動でチャンネルに通知します。
                </p>
                
                <div className="settings-form-group">
                  <label htmlFor="discord-webhook-url">Discord Webhook URL</label>
                  <input
                    type="url"
                    id="discord-webhook-url"
                    className="todo-input"
                    style={{ fontSize: "0.85rem", width: "100%", height: "42px" }}
                    placeholder="https://discord.com/api/webhooks/..."
                    value={discordWebhookUrl}
                    onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                  />
                  <span className="input-hint">
                    ※ チャンネル設定の「連携サービス」から Webhook URL を取得して貼り付けてください。
                  </span>
                </div>

                <div className="settings-form-group">
                  <label htmlFor="discord-notify-time">毎日の通知時間 (日本時間 JST)</label>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                      type="time"
                      id="discord-notify-time"
                      className="date-input"
                      style={{ width: "110px", height: "40px", fontSize: "0.95rem", textAlign: "center" }}
                      value={discordNotifyTime}
                      onChange={(e) => setDiscordNotifyTime(e.target.value)}
                    />
                    <span className="input-hint">
                      この時間に、今日締め切りを迎える未完了のタスク一覧を自動通知します。
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "4px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="test-webhook-btn"
                    onClick={async () => {
                      if (!discordWebhookUrl) {
                        setTestStatus("error");
                        alert("Webhook URLを入力してください。");
                        return;
                      }
                      setIsTestingDiscord(true);
                      setTestStatus(null);
                      try {
                        const res = await fetch("/api/discord/test", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ webhookUrl: discordWebhookUrl }),
                        });
                        if (res.ok) {
                          setTestStatus("success");
                        } else {
                          setTestStatus("error");
                        }
                      } catch {
                        setTestStatus("error");
                      } finally {
                        setIsTestingDiscord(false);
                      }
                    }}
                    disabled={isTestingDiscord}
                  >
                    {isTestingDiscord ? "送信中..." : "🔗 テスト送信を実行"}
                  </button>

                  {testStatus === "success" && (
                    <span className="status-success-badge">✅ 送信成功！</span>
                  )}
                  {testStatus === "error" && (
                    <span className="status-error-badge">❌ 送信失敗</span>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="modal-save-btn"
                onClick={() => {
                  updateState(tasks, categories, discordWebhookUrl, discordNotifyTime);
                  setShowSettingsModal(false);
                  setTestStatus(null);
                }}
              >
                設定を保存して閉じる
              </button>
              <button
                type="button"
                className="modal-cancel-btn"
                onClick={() => {
                  const local = loadFromLocalStorage();
                  setDiscordWebhookUrl(local.discordWebhookUrl);
                  setDiscordNotifyTime(local.discordNotifyTime);
                  setShowSettingsModal(false);
                  setTestStatus(null);
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

      {/* ── Mind Map View Overlay — rendered OUTSIDE app-container so position:fixed z-index works ── */}
      {mapRootTaskId && (
        <MindMapView
          tasks={tasks}
          rootTaskId={mapRootTaskId}
          onClose={() => setMapRootTaskId(null)}
          onToggleComplete={(id) => handleToggleComplete(id)}
          onOpenEdit={(task) => handleOpenEdit(task, { stopPropagation: () => {} } as React.MouseEvent)}
          onAddSubtask={(parentId) => {
            const tempTask = {
              id: Date.now().toString(),
              text: "新しい子タスク",
              completed: false,
              category: tasks.find(t => t.id === parentId)?.category || categories[0],
              priority: tasks.find(t => t.id === parentId)?.priority || "medium",
              isRoutine: false,
              parentId: parentId,
              createdAt: Date.now()
            };
            setEditingTask(tempTask as Task);
            setEditText(tempTask.text);
            setEditDescription("");
            setEditCategory(tempTask.category);
            setEditPriority(tempTask.priority);
            setEditParentId(tempTask.parentId || "");
            setEditStartDate("");
            setEditDueDate("");
            setEditDueTime("");
            setEditIsRoutine(false);
          }}
        />
      )}
    </>
  );
}
