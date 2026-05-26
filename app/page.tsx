"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import confetti from "canvas-confetti";

// ── Task interface ──────────────────────────────────────────────────────────
interface Task {
  id: string;
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
  const gcalEnabled = !!(session as any)?.accessToken;
  // ── Sync States ──
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<string[]>(["勉強用", "その他"]);

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

  const loadFromLocalStorage = (): { tasks: Task[]; categories: string[]; lastWrite: number } => {
    try {
      const t = localStorage.getItem(LS_TASKS);
      const c = localStorage.getItem(LS_CATS);
      const w = localStorage.getItem(LS_LAST_WRITE);
      const rawTasks: Task[] = t ? JSON.parse(t) : [];
      // Ensure all tasks have required fields (backward-compat migration)
      const migratedTasks = rawTasks.map((task: any) => ({
        priority: "medium" as Task["priority"],
        isRoutine: false,
        ...task,
      }));
      return {
        tasks: migratedTasks,
        categories: c ? JSON.parse(c) : ["勉強用", "その他"],
        lastWrite: w ? Number(w) : 0,
      };
    } catch {
      return { tasks: [], categories: ["勉強用", "その他"], lastWrite: 0 };
    }
  };

  const saveToLocalStorage = (t: Task[], c: string[]) => {
    try {
      const now = Date.now();
      localStorage.setItem(LS_TASKS, JSON.stringify(t));
      localStorage.setItem(LS_CATS, JSON.stringify(c));
      localStorage.setItem(LS_LAST_WRITE, String(now));
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

      const serverTasks: Task[] = (data.tasks || []).map((task: any) => ({
        priority: "medium" as Task["priority"],
        isRoutine: false,
        ...task,
        category: task.category === "study" ? "勉強用" : task.category === "other" ? "その他" : task.category,
      }));
      const serverCats: string[] = (data.categories || ["勉強用", "その他"]).map((c: string) =>
        c === "study" ? "勉強用" : c === "other" ? "その他" : c
      );

      const local = loadFromLocalStorage();
      if (serverTasks.length === 0 && local.tasks.length > 0) {
        serverAvailable.current = false;
        return;
      }

      const useServer = serverTasks.length >= local.tasks.length;
      const finalTasks = applyRoutineRestore(useServer ? serverTasks : local.tasks);
      const finalCats = useServer ? serverCats : local.categories;

      setTasks(finalTasks);
      setCategories(finalCats);
      saveToLocalStorage(finalTasks, finalCats);
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
      setTasks(restored);
      setCategories(local.categories);
    }
    
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
  }, [tasks, categories]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const saveStateToServer = async (updatedTasks: Task[], updatedCategories: string[]) => {
    lastLocalWrite.current = Date.now();
    saveToLocalStorage(updatedTasks, updatedCategories);
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: updatedTasks, categories: updatedCategories }),
      });
    } catch { /* localStorage already saved */ }
  };

  const updateState = (newTasks: Task[], newCategories: string[]) => {
    setTasks(newTasks);
    setCategories(newCategories);
    saveStateToServer(newTasks, newCategories);
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
    setInputText("");
    setDescription("");
    setStartDate("");
    setDueDate("");
    setDueTime("");
    setPriority("medium");
    setIsRoutine(false);
    setShowOptions(false);
  };

  const handleToggleComplete = async (id: string) => {
    const task = tasks.find((t) => t.id === id);
    const willComplete = task && !task.completed;

    const updated = tasks.map((t) => {
      if (t.id !== id) return t;
      const newCompleted = !t.completed;
      return {
        ...t,
        completed: newCompleted,
        lastRoutineDate: newCompleted && t.isRoutine ? todayISO() : t.lastRoutineDate,
      };
    });
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

  const renderPrioritySection = (
    priority: "high" | "medium" | "low",
    label: string,
    colorClass: string,
    sectionTasks: Task[]
  ) => {
    return (
      <div className={`priority-section priority-section--${priority}`} key={priority}>
        <div className="priority-section-header">
          <div className="priority-section-title-wrap">
            <span className={`priority-section-dot priority-section-dot--${priority}`} />
            <h3 className="priority-section-title">{label}</h3>
          </div>
          <span className="priority-section-count">
            {sectionTasks.length}
          </span>
        </div>

        <ul className="todo-list">
          {sectionTasks.length > 0 ? (
            sectionTasks.map((task) => {
              const dateStatus = getDateStatus(task.dueDate, task.dueTime, task.completed);
              const isExpanded = expandedTaskId === task.id;
              return (
                <li
                  key={task.id}
                  className={`todo-item priority-border--${task.priority ?? "medium"} ${task.completed ? "completed" : ""}`}
                  onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                  id={`task-item-${task.id}`}
                >
                  <div className="todo-item-main-row">
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

                    <button type="button" className="delete-btn" onClick={(e) => handleDeleteTask(task.id, e)} title="タスクを削除" id={`task-delete-btn-${task.id}`}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>

                  {/* Expanded panel */}
                  {isExpanded && (
                    <div className="todo-expanded-panel" onClick={(e) => e.stopPropagation()}>
                      {/* Priority editor */}
                      <div>
                        <div className="todo-desc-label">優先度</div>
                        <div className="priority-selector" style={{ marginTop: "6px" }}>
                          {(["high", "medium", "low"] as Task["priority"][]).map((p) => (
                            <button
                              key={p}
                              type="button"
                              className={`priority-btn priority-btn--${p} ${(task.priority ?? "medium") === p ? "selected" : ""}`}
                              onClick={() => {
                                const updated = tasks.map((t) => t.id === task.id ? { ...t, priority: p } : t);
                                updateState(updated, categories);
                              }}
                            >
                              <span className={`priority-dot priority-dot--${p}`} />
                              {PRIORITY_LABEL[p]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="todo-desc-label">具体的な詳細内容（メモ）</div>
                      <div className="todo-desc-text">{task.description || "詳細メモはありません。"}</div>

                      <a href={getGoogleCalendarUrl(task)} target="_blank" rel="noopener noreferrer" className="calendar-sync-btn">
                        <svg viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                          <circle cx="12" cy="16" r="2" />
                        </svg>
                        Googleカレンダーに登録
                      </a>
                    </div>
                  )}
                </li>
              );
            })
          ) : (
            <div className="priority-empty-state">
              <p>この優先度のタスクはありません。</p>
            </div>
          )}
        </ul>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="header-top">
          <div>
            <h1>FocusTodo</h1>
            <p>Your synchronized personal space</p>
          </div>
          {/* Google Sign-in */}
          {session ? (
            <button
              type="button"
              className="gcal-signin-btn gcal-signin-btn--signed"
              onClick={() => signOut({ redirect: false })}
              title={`${session.user?.name ?? session.user?.email} としてサインイン中`}
            >
              {session.user?.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={session.user.image} alt="" className="gcal-avatar" />
              )}
              <span>🔗 カレンダー連携中</span>
              <span className="gcal-signout-hint">（タップでサインアウト）</span>
            </button>
          ) : (
            <button
              type="button"
              className="gcal-signin-btn"
              onClick={() => signIn("google", { callbackUrl: window.location.origin })}
            >
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Googleでサインイン
            </button>
          )}
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

      {/* 2-column grid */}
      <div className="app-grid">

        {/* ── Left Column ── */}
        <div className="form-column">

          {/* ── Pomodoro Timer ── */}
          <div className="pomodoro-card">
            <div className="pomodoro-header">
              <span className="pomodoro-title">
                {timerMode === "work" ? "🍅 集中タイマー" : "☕ 休憩タイム"}
              </span>
              <span className="pomodoro-cycles">完了: {timerCycles}セット</span>
            </div>

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
    </div>
  );
}
