"use client";

import { useState, useEffect, useRef } from "react";

// Task interface
interface Task {
  id: string;
  text: string;
  description?: string;
  completed: boolean;
  category: string;
  startDate?: string;
  dueDate?: string;
  dueTime?: string;
  notified?: boolean;
  createdAt: number;
}

export default function Home() {
  // Sync States
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<string[]>(["勉強用", "その他"]);
  
  // Form input states
  const [inputText, setInputText] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("勉強用");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  
  // Custom Category Add Input
  const [showNewCatInput, setShowNewCatInput] = useState(false);
  const [newCatText, setNewCatText] = useState("");

  // UI accordion expander states
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  
  // Notification state
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");
  
  // Sync flags
  const [isMounted, setIsMounted] = useState(false);
  const isLoaded = useRef(false);

  // Request browser notifications
  const requestNotificationPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      if (permission === "granted") {
        new Notification("FocusTodo", {
          body: "リマインダー通知が有効になりました！",
        });
      }
    } catch (err) {
      console.error("Failed to request notification permission:", err);
    }
  };

  // Fetch from server
  const fetchState = async () => {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const data = await res.json();
        
        const migratedTasks = (data.tasks || []).map((task: any) => {
          let migratedCat = task.category;
          if (task.category === "study") migratedCat = "勉強用";
          else if (task.category === "other") migratedCat = "その他";
          return { ...task, category: migratedCat };
        });

        const migratedCategories = (data.categories || ["勉強用", "その他"]).map((cat: string) => {
          if (cat === "study") return "勉強用";
          if (cat === "other") return "その他";
          return cat;
        });

        setTasks(migratedTasks);
        setCategories(migratedCategories);
        
        if (!migratedCategories.includes(category) && migratedCategories.length > 0) {
          setCategory(migratedCategories[0]);
        }
      }
    } catch (error) {
      console.error("Failed to fetch state from server:", error);
    }
  };

  // Initial load
  useEffect(() => {
    setIsMounted(true);
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPermission(Notification.permission);
    }
    
    fetchState().then(() => {
      isLoaded.current = true;
    });

    const syncInterval = setInterval(() => {
      fetchState();
    }, 5000);

    return () => clearInterval(syncInterval);
  }, [category]);

  // Save back to server
  const saveStateToServer = async (updatedTasks: Task[], updatedCategories: string[]) => {
    if (!isLoaded.current) return;
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: updatedTasks,
          categories: updatedCategories
        }),
      });
    } catch (error) {
      console.error("Failed to save state to server:", error);
    }
  };

  const updateState = (newTasks: Task[], newCategories: string[]) => {
    setTasks(newTasks);
    setCategories(newCategories);
    saveStateToServer(newTasks, newCategories);
  };

  // Add new task
  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedText = inputText.trim();
    if (!trimmedText) return;

    const newTask: Task = {
      id: Date.now().toString(),
      text: trimmedText,
      description: description.trim() || undefined,
      completed: false,
      category: category,
      startDate: startDate || undefined,
      dueDate: dueDate || undefined,
      dueTime: dueTime || undefined,
      notified: false,
      createdAt: Date.now(),
    };

    const updated = [newTask, ...tasks];
    updateState(updated, categories);

    // Reset inputs
    setInputText("");
    setDescription("");
    setStartDate("");
    setDueDate("");
    setDueTime("");
    setShowOptions(false);
  };

  // Toggle complete status
  const handleToggleComplete = (id: string) => {
    const updated = tasks.map((task) =>
      task.id === id ? { ...task, completed: !task.completed } : task
    );
    updateState(updated, categories);
  };

  // Delete task
  const handleDeleteTask = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = tasks.filter((task) => task.id !== id);
    updateState(updated, categories);
    if (expandedTaskId === id) {
      setExpandedTaskId(null);
    }
  };

  // Clear completed
  const handleClearCompleted = () => {
    const updated = tasks.filter((task) => !task.completed);
    updateState(updated, categories);
    setExpandedTaskId(null);
  };

  // Add category
  const handleAddCategory = (e: React.MouseEvent) => {
    e.preventDefault();
    const trimmedCat = newCatText.trim();
    if (!trimmedCat) return;
    
    if (categories.includes(trimmedCat)) {
      setCategory(trimmedCat);
      setNewCatText("");
      setShowNewCatInput(false);
      return;
    }

    const updatedCategories = [...categories, trimmedCat];
    setCategory(trimmedCat);
    updateState(tasks, updatedCategories);
    
    setNewCatText("");
    setShowNewCatInput(false);
  };

  // Delete category
  const handleDeleteCategory = (catToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    if (categories.length <= 1) return;
    
    const updatedCategories = categories.filter((c) => c !== catToDelete);
    
    if (category === catToDelete) {
      setCategory(updatedCategories[0]);
    }
    if (categoryFilter === catToDelete) {
      setCategoryFilter("all");
    }

    const fallbackCategory = updatedCategories.includes("その他") ? "その他" : updatedCategories[0];
    const updatedTasks = tasks.map((task) => 
      task.category === catToDelete ? { ...task, category: fallbackCategory } : task
    );

    updateState(updatedTasks, updatedCategories);
  };

  // Reminder Engine
  useEffect(() => {
    const checkReminders = () => {
      const now = new Date();
      let hasUpdates = false;

      const updatedTasks = tasks.map((task) => {
        if (task.completed || task.notified || !task.dueDate) return task;

        const [year, month, day] = task.dueDate.split("-").map(Number);
        const [hour, min] = task.dueTime ? task.dueTime.split(":").map(Number) : [0, 0];
        
        const deadlineDate = new Date(year, month - 1, day, hour, min, 0);

        if (now >= deadlineDate) {
          hasUpdates = true;
          
          if (Notification.permission === "granted") {
            new Notification("⏰ FocusTodo リマインダー", {
              body: `タスク「${task.text}」の締切時間になりました！`,
            });
          }
          
          return { ...task, notified: true };
        }

        return task;
      });

      if (hasUpdates) {
        updateState(updatedTasks, categories);
      }
    };

    const reminderInterval = setInterval(checkReminders, 10000);
    return () => clearInterval(reminderInterval);
  }, [tasks, categories]);

  // Generate pre-filled Google Calendar URL
  const getGoogleCalendarUrl = (task: Task) => {
    const title = encodeURIComponent(task.text);
    
    let detailsText = task.description || "";
    if (task.startDate) {
      detailsText = `[開始日] ${task.startDate}\n\n${detailsText}`;
    }
    detailsText = `${detailsText}\n\n---\nCreated via FocusTodo`;
    const details = encodeURIComponent(detailsText);
    
    let startStr = "";
    if (task.startDate) {
      startStr = task.startDate.replace(/-/g, "");
    } else {
      const d = new Date(task.createdAt);
      startStr = d.toISOString().substring(0, 10).replace(/-/g, "");
    }

    let endStr = "";
    if (task.dueDate) {
      endStr = task.dueDate.replace(/-/g, "");
      if (task.dueTime) {
        endStr += `T${task.dueTime.replace(/:/g, "")}00`;
      } else {
        endStr += "T235959";
      }
    } else {
      endStr = startStr;
    }

    const dates = `${startStr}/${endStr}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&dates=${dates}`;
  };

  // Filter lists
  const filteredTasks = tasks.filter((task) => {
    const matchesStatus =
      statusFilter === "active" ? !task.completed :
      statusFilter === "completed" ? task.completed : true;

    const matchesCategory =
      categoryFilter === "all" ? true : task.category === categoryFilter;

    return matchesStatus && matchesCategory;
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

    if (now > deadline) {
      return { label: `期限切れ (${formatted})`, type: "danger" };
    }
    
    if (today.getTime() === deadlineDateOnly.getTime()) {
      return { label: `本日締切 (${formatted})`, type: "warning" };
    }

    return { label: `締切: ${formatted}`, type: "normal" };
  };

  const activeTasksCount = tasks.filter((task) => !task.completed).length;
  const completedTasksCount = tasks.length - activeTasksCount;

  if (!isMounted) {
    return (
      <div className="app-container" style={{ opacity: 0.5 }}>
        <header className="header">
          <h1>FocusTodo</h1>
          <p>Initializing your space...</p>
        </header>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <h1>FocusTodo</h1>
        <p>Your synchronized personal space</p>
      </header>

      {/* Push Notification permission banner */}
      {notifPermission === "default" && (
        <div className="notif-banner">
          <span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            リマインダー通知を有効にしますか？
          </span>
          <button type="button" className="notif-btn" onClick={requestNotificationPermission}>
            通知を許可
          </button>
        </div>
      )}

      {/* Responsive Grid Wrapper splits PC view in 2 columns */}
      <div className="app-grid">
        
        {/* Left Column: Command & Input Form Panel */}
        <div className="form-column">
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
              <button type="submit" className="add-button" id="todo-add-btn">
                追加
              </button>
            </div>

            {/* Options Expander button */}
            <button
              type="button"
              className={`toggle-options-btn ${showOptions ? "expanded" : ""}`}
              onClick={() => setShowOptions(!showOptions)}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {showOptions ? "詳細設定を閉じる" : "カテゴリー・日時・詳細を入力"}
            </button>

            {/* Detailed Options panel drawer */}
            {showOptions && (
              <div className="form-options-panel">
                {/* Category tags */}
                <div className="option-group">
                  <label>カテゴリー</label>
                  <div className="category-select-container" style={{ flexWrap: "wrap", rowGap: "8px" }}>
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={`category-select-btn ${category === cat ? "selected study" : ""}`}
                        onClick={() => setCategory(cat)}
                        style={{ position: "relative", paddingRight: categories.length > 1 ? "24px" : "14px" }}
                      >
                        {cat}
                        {categories.length > 1 && (
                          <span
                            onClick={(e) => handleDeleteCategory(cat, e)}
                            style={{
                              position: "absolute",
                              right: "6px",
                              top: "50%",
                              transform: "translateY(-50%)",
                              fontSize: "10px",
                              opacity: 0.5,
                              cursor: "pointer"
                            }}
                            title="カテゴリーを削除"
                          >
                            ✕
                          </span>
                        )}
                      </button>
                    ))}

                    {!showNewCatInput ? (
                      <button
                        type="button"
                        className="category-select-btn"
                        style={{ background: "rgba(129, 140, 248, 0.15)", borderColor: "rgba(129, 140, 248, 0.3)", color: "var(--accent-primary)" }}
                        onClick={() => setShowNewCatInput(true)}
                      >
                        ➕ 追加
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input
                          type="text"
                          className="date-input"
                          style={{ padding: "4px 8px", width: "120px", height: "30px" }}
                          placeholder="新しい名..."
                          value={newCatText}
                          onChange={(e) => setNewCatText(e.target.value)}
                          maxLength={15}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="add-button"
                          style={{ height: "30px", padding: "0 10px", fontSize: "0.8rem", borderRadius: "8px" }}
                          onClick={handleAddCategory}
                        >
                          追加
                        </button>
                        <button
                          type="button"
                          className="category-select-btn"
                          style={{ height: "30px", padding: "0 10px", borderRadius: "8px" }}
                          onClick={() => setShowNewCatInput(false)}
                        >
                          キャンセル
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Detailed Description Notes input */}
                <div className="option-group">
                  <label>具体的な詳細内容（メモ・詳細手順）</label>
                  <textarea
                    className="todo-textarea"
                    placeholder="具体的なタスクの手順や内容を入力してください..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={500}
                  />
                </div>

                {/* Start and end dates picker grid */}
                <div className="option-row">
                  <div className="option-group">
                    <label>開始日</label>
                    <input
                      type="date"
                      className="date-input"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>

                  <div className="option-group">
                    <label>締切日時</label>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input
                        type="date"
                        className="date-input"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                      />
                      <input
                        type="time"
                        className="date-input"
                        style={{ width: "80px" }}
                        value={dueTime}
                        onChange={(e) => setDueTime(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Right Column: Dynamic Active Task List, Filter Tabs, & Clear Actions */}
        <div className="list-column">
          {/* Filtering row controls */}
          <div className="controls-row">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="category-filter-tabs" style={{ flexWrap: "wrap", rowGap: "4px" }}>
                <button
                  type="button"
                  className={`cat-tab-btn ${categoryFilter === "all" ? "active all" : ""}`}
                  onClick={() => setCategoryFilter("all")}
                >
                  すべて
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`cat-tab-btn ${categoryFilter === cat ? "active study" : ""}`}
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              
              <span className="task-counter" style={{ fontSize: "0.8rem", color: "var(--text-muted)", flexShrink: 0 }}>
                同期中 🟢
              </span>
            </div>

            <div className="sub-controls-row">
              <span className="task-counter" id="active-count-label">
                {activeTasksCount > 0 ? `未完了: ${activeTasksCount}個` : "すべて完了！"}
              </span>

              <div className="filter-tabs">
                <button
                  type="button"
                  className={`tab-btn ${statusFilter === "all" ? "active" : ""}`}
                  onClick={() => setStatusFilter("all")}
                  id="tab-all"
                >
                  すべて
                </button>
                <button
                  type="button"
                  className={`tab-btn ${statusFilter === "active" ? "active" : ""}`}
                  onClick={() => setStatusFilter("active")}
                  id="tab-active"
                >
                  未完了
                </button>
                <button
                  type="button"
                  className={`tab-btn ${statusFilter === "completed" ? "active" : ""}`}
                  onClick={() => setStatusFilter("completed")}
                  id="tab-completed"
                >
                  完了
                </button>
              </div>
            </div>
          </div>

          {/* Task list with Accordion Expansion drawers */}
          <ul className="todo-list" id="todo-task-list">
            {filteredTasks.length > 0 ? (
              filteredTasks.map((task) => {
                const dateStatus = getDateStatus(task.dueDate, task.dueTime, task.completed);
                const isExpanded = expandedTaskId === task.id;
                
                return (
                  <li
                    key={task.id}
                    className={`todo-item ${task.completed ? "completed" : ""}`}
                    onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                    id={`task-item-${task.id}`}
                  >
                    {/* Main Visible Card Row */}
                    <div className="todo-item-main-row">
                      <div className="todo-item-left">
                        {/* Custom Checkbox (stop event from expanding card) */}
                        <div
                          className="custom-checkbox"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleComplete(task.id);
                          }}
                        >
                          <svg viewBox="0 0 24 24">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                        
                        <div className="todo-content-wrapper">
                          <div className="todo-text-row">
                            {/* Dynamic Category Pill Tag */}
                            <span className={`cat-badge ${task.category === "勉強用" ? "study" : "other"}`}>
                              {task.category}
                            </span>
                            
                            <span className="todo-text">{task.text}</span>
                            
                            {/* Little memo file page icon showing task has descriptions */}
                            {task.description && (
                              <span className="has-desc-indicator" title="詳細メモあり">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                  <line x1="16" y1="13" x2="8" y2="13" />
                                  <line x1="16" y1="17" x2="8" y2="17" />
                                  <polyline points="10 9 9 9 8 9" />
                                </svg>
                              </span>
                            )}
                          </div>

                          {/* Small Start/Due Date Badges row */}
                          {(task.startDate || dateStatus.label) && (
                            <div className="dates-row">
                              {task.startDate && (
                                <span className="date-badge">
                                  <svg viewBox="0 0 24 24" strokeWidth="2">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                    <line x1="16" y1="2" x2="16" y2="6" />
                                    <line x1="8" y1="2" x2="8" y2="6" />
                                    <line x1="3" y1="10" x2="21" y2="10" />
                                  </svg>
                                  開始: {task.startDate.substring(5).replace("-", "/")}
                                </span>
                              )}
                              
                              {dateStatus.label && (
                                <span className={`date-badge ${dateStatus.type}`}>
                                  <svg viewBox="0 0 24 24" strokeWidth="2.5">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="12 6 12 12 16 14" />
                                  </svg>
                                  {dateStatus.label}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Delete individual action */}
                      <button
                        type="button"
                        className="delete-btn"
                        onClick={(e) => handleDeleteTask(task.id, e)}
                        title="タスクを削除"
                        id={`task-delete-btn-${task.id}`}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>

                    {/* 滑らかに展開する詳細アコーディオンパネル */}
                    {isExpanded && (
                      <div className="todo-expanded-panel" onClick={(e) => e.stopPropagation()}>
                        <div className="todo-desc-label">具体的な詳細内容（メモ）</div>
                        <div className="todo-desc-text">
                          {task.description ? task.description : "詳細メモはありません。"}
                        </div>

                        {/* Pre-filled zero-setup Google Calendar sync link */}
                        <a
                          href={getGoogleCalendarUrl(task)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="calendar-sync-btn"
                        >
                          <svg viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
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
              <div className="empty-state" id="todo-empty-state">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p>
                  {categoryFilter === "all"
                    ? "タスクがありません。新しく追加してみましょう！"
                    : `「${categoryFilter}」のタスクはありません。`}
                </p>
              </div>
            )}
          </ul>

          {/* Bulk Clear Completed */}
          {completedTasksCount > 0 && (
            <div
              className="controls-row"
              style={{ borderBottom: "none", marginTop: "16px", paddingBottom: 0 }}
            >
              <span />
              <button
                type="button"
                className="clear-btn"
                onClick={handleClearCompleted}
                id="clear-completed-btn"
              >
                完了したタスクを一括消去
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Footer */}
      <footer className="footer-note">
        <p>© {new Date().getFullYear()} FocusTodo. Securely Connected.</p>
      </footer>
    </div>
  );
}
