"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { Task } from "../page";

interface MindMapViewProps {
  tasks: Task[];
  rootTaskIds?: string[];
  onClose: () => void;
  onToggleComplete: (id: string) => void;
  onOpenEdit: (task: Task) => void;
  onAddSubtask: (parentId: string) => void;
}

// Layout constants
const NODE_WIDTH = 220;
const NODE_HEIGHT = 44;
const H_GAP = 80; // horizontal gap between levels
const V_GAP = 20; // vertical gap between siblings

interface LayoutNode {
  task: Task;
  x: number;
  y: number;
  width: number;
  height: number;
  children: LayoutNode[];
}

function buildTree(taskId: string, tasks: Task[], collapsed: Set<string>, x: number): LayoutNode | null {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;

  const directChildren = tasks.filter((t) => t.parentId === taskId);
  const childNodes: LayoutNode[] = [];

  if (!collapsed.has(taskId)) {
    for (const child of directChildren) {
      const node = buildTree(child.id, tasks, collapsed, x + NODE_WIDTH + H_GAP);
      if (node) childNodes.push(node);
    }
  }

  const totalChildrenHeight =
    childNodes.length > 0
      ? childNodes.reduce((sum, n) => sum + n.height, 0) + (childNodes.length - 1) * V_GAP
      : 0;

  const ownHeight = Math.max(NODE_HEIGHT, totalChildrenHeight);

  return {
    task,
    x,
    y: 0, // will be set by layout pass
    width: NODE_WIDTH,
    height: ownHeight,
    children: childNodes,
  };
}

function assignY(node: LayoutNode, startY: number): void {
  if (node.children.length === 0) {
    node.y = startY + (node.height - NODE_HEIGHT) / 2;
    return;
  }

  // Layout children
  let cursor = startY;
  for (const child of node.children) {
    assignY(child, cursor);
    cursor += child.height + V_GAP;
  }

  // Center parent on children
  const firstChildMid = node.children[0].y + NODE_HEIGHT / 2;
  const lastChildMid = node.children[node.children.length - 1].y + NODE_HEIGHT / 2;
  node.y = (firstChildMid + lastChildMid) / 2 - NODE_HEIGHT / 2;
}

function flattenTree(node: LayoutNode): LayoutNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

function collectEdges(node: LayoutNode): Array<{ from: LayoutNode; to: LayoutNode }> {
  const edges: Array<{ from: LayoutNode; to: LayoutNode }> = [];
  for (const child of node.children) {
    edges.push({ from: node, to: child });
    edges.push(...collectEdges(child));
  }
  return edges;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#3b82f6",
};

export default function MindMapView({
  tasks,
  rootTaskIds,
  onClose,
  onToggleComplete,
  onOpenEdit,
  onAddSubtask,
}: MindMapViewProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [canvasSize, setCanvasSize] = useState({ width: 2000, height: 1200 });
  const [pan, setPan] = useState({ x: 60, y: 0 });
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  const pinchStart = useRef({ dist: 0, scale: 1 });
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // Build layout
  const rootIds = rootTaskIds || tasks.filter((t) => !t.parentId).map((t) => t.id);
  const childNodes = rootIds.map((id) => buildTree(id, tasks, collapsedIds, 0)).filter(Boolean) as LayoutNode[];

  const totalChildrenHeight =
    childNodes.length > 0
      ? childNodes.reduce((sum, n) => sum + n.height, 0) + (childNodes.length - 1) * V_GAP
      : 0;

  const virtualRoot: LayoutNode = {
    task: { id: "VIRTUAL_ROOT", text: "", completed: false, category: "", priority: "medium", createdAt: 0 },
    x: -(NODE_WIDTH + H_GAP),
    y: 0,
    width: 0,
    height: totalChildrenHeight,
    children: childNodes,
  };

  let allNodes: LayoutNode[] = [];
  let edges: Array<{ from: LayoutNode; to: LayoutNode }> = [];
  let totalHeight = 800;

  if (virtualRoot.children.length > 0) {
    assignY(virtualRoot, 0);
    allNodes = virtualRoot.children.flatMap(flattenTree);
    edges = virtualRoot.children.flatMap(collectEdges);
    totalHeight = Math.max(800, virtualRoot.height + 80);
  }

  // Recalculate canvas size
  useEffect(() => {
    if (allNodes.length === 0) return;
    const maxX = Math.max(...allNodes.map((n) => n.x + n.width));
    const maxY = Math.max(...allNodes.map((n) => n.y + NODE_HEIGHT));
    setCanvasSize({ width: maxX + 100, height: Math.max(maxY + 100, 600) });
    // Center vertically
    if (containerRef.current && allNodes.length > 0) {
      const minY = Math.min(...allNodes.map(n => n.y));
      const midY = (minY + maxY) / 2;
      const containerH = containerRef.current.clientHeight;
      setPan((p) => ({ ...p, y: containerH / 2 - midY }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedIds, tasks, rootTaskIds]);

  // Mouse pan handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".mm-node")) return;
    setIsPanning(true);
    panStart.current = { mouseX: e.clientX, mouseY: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStart.current.mouseX;
    const dy = e.clientY - panStart.current.mouseY;
    setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
  }, [isPanning]);

  const onMouseUp = useCallback(() => setIsPanning(false), []);

  // Touch handlers (mobile) — 1 finger = pan, 2 fingers = pinch zoom
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      pinchStart.current = { dist: Math.hypot(dx, dy), scale };
      setIsPanning(false);
    } else if (e.touches.length === 1) {
      if ((e.target as HTMLElement).closest(".mm-node")) return;
      const t = e.touches[0];
      setIsPanning(true);
      panStart.current = { mouseX: t.clientX, mouseY: t.clientY, panX: pan.x, panY: pan.y };
    }
  }, [pan, scale]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      // Pinch zoom
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const newDist = Math.hypot(dx, dy);
      const ratio = newDist / pinchStart.current.dist;
      const newScale = Math.min(3, Math.max(0.3, pinchStart.current.scale * ratio));
      setScale(newScale);
    } else if (e.touches.length === 1 && isPanning) {
      const t = e.touches[0];
      const ddx = t.clientX - panStart.current.mouseX;
      const ddy = t.clientY - panStart.current.mouseY;
      setPan({ x: panStart.current.panX + ddx, y: panStart.current.panY + ddy });
    }
  }, [isPanning]);

  const onTouchEnd = useCallback(() => setIsPanning(false), []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,  /* modals are at 10000, so they appear on top */
        background: "rgb(7, 11, 22)",  /* fully opaque — no transparency */
        display: "flex",
        flexDirection: "column",
        fontFamily: "inherit",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Header */}
      <div
        style={{
          minHeight: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(10,15,30,0.95)",
          flexShrink: 0,
          gap: 8,
        }}
      >
        {/* Back button — large tap target for mobile */}
        <button
          onClick={onClose}
          style={{
            background: "rgba(100,130,255,0.2)",
            border: "1px solid rgba(100,130,255,0.4)",
            color: "#c7d2fe",
            padding: "10px 16px",
            borderRadius: 12,
            fontSize: "0.95rem",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            minHeight: 44,
            minWidth: 44,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ display: "none", fontSize: "0.85rem" }}>戻る</span>
          戻る
        </button>

        <div style={{ color: "#7c8ff0", fontWeight: 700, fontSize: "0.95rem", flex: 1, textAlign: "center" }}>
          🌳 ツリービュー
        </div>

        {/* Zoom reset */}
        <button
          onClick={() => setScale(1)}
          style={{
            background: Math.abs(scale - 1) > 0.05 ? "rgba(100,130,255,0.25)" : "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.7)",
            padding: "8px 12px",
            borderRadius: 10,
            fontSize: "0.78rem",
            cursor: "pointer",
            flexShrink: 0,
            minHeight: 44,
            fontVariantNumeric: "tabular-nums",
          }}
          title="ズームリセット"
        >
          {Math.round(scale * 100)}%
        </button>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "hidden",
          cursor: isPanning ? "grabbing" : "grab",
          position: "relative",
          touchAction: "none", // Prevent browser scroll hijacking on mobile
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Subtle grid background */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `
              radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)
            `,
            backgroundSize: "32px 32px",
            pointerEvents: "none",
          }}
        />

        {/* Transformed canvas */}
        <div
          style={{
            position: "absolute",
            top: pan.y,
            left: pan.x,
            width: canvasSize.width,
            height: canvasSize.height,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {/* SVG Edges */}
          <svg
            style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
            width={canvasSize.width}
            height={canvasSize.height}
          >
            {edges.map(({ from, to }, i) => {
              const x1 = from.x + from.width;
              const y1 = from.y + NODE_HEIGHT / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_HEIGHT / 2;
              const midX = (x1 + x2) / 2;
              const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
              return (
                <path
                  key={i}
                  d={path}
                  fill="none"
                  stroke="rgba(120, 140, 240, 0.35)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {allNodes.map((node) => {
            const task = node.task;
            const children = tasks.filter((t) => t.parentId === task.id);
            const hasChildren = children.length > 0 || tasks.some((t) => t.parentId === task.id);
            const isCollapsed = collapsedIds.has(task.id);
            const isRoot = rootIds.includes(task.id);
            const priorityColor = PRIORITY_COLORS[task.priority ?? "medium"];
            const completedChildren = tasks.filter((t) => t.parentId === task.id && t.completed).length;
            const totalChildren = tasks.filter((t) => t.parentId === task.id).length;

            return (
              <div
                key={task.id}
                className="mm-node"
                style={{
                  position: "absolute",
                  left: node.x,
                  top: node.y,
                  width: NODE_WIDTH,
                  height: NODE_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: NODE_HEIGHT,
                    background: isRoot
                      ? "rgba(80, 100, 200, 0.25)"
                      : task.completed
                      ? "rgba(30, 40, 60, 0.5)"
                      : "rgba(24, 34, 58, 0.9)",
                    border: `1px solid ${isRoot ? "rgba(100,130,255,0.5)" : task.completed ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)"}`,
                    borderLeft: `3px solid ${priorityColor}`,
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0 10px 0 8px",
                    boxShadow: isRoot ? "0 0 20px rgba(80,100,200,0.2)" : "0 2px 8px rgba(0,0,0,0.3)",
                    backdropFilter: "blur(8px)",
                    cursor: "default",
                    transition: "all 0.2s",
                    overflow: "hidden",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(120,150,255,0.6)";
                    e.currentTarget.style.background = isRoot ? "rgba(80,100,200,0.35)" : "rgba(40,55,90,0.9)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = isRoot ? "rgba(100,130,255,0.5)" : task.completed ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)";
                    e.currentTarget.style.background = isRoot ? "rgba(80,100,200,0.25)" : task.completed ? "rgba(30,40,60,0.5)" : "rgba(24,34,58,0.9)";
                  }}
                >
                  {/* Checkbox */}
                  <div
                    onClick={(e) => { e.stopPropagation(); onToggleComplete(task.id); }}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: task.completed ? "none" : "1.5px solid rgba(255,255,255,0.35)",
                      background: task.completed ? "#22c55e" : "transparent",
                      flexShrink: 0,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.15s",
                    }}
                  >
                    {task.completed && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>

                  {/* Task text */}
                  <div
                    onClick={(e) => { e.stopPropagation(); onOpenEdit(task); }}
                    title={task.text}
                    style={{
                      flex: 1,
                      fontSize: isRoot ? "0.9rem" : "0.83rem",
                      fontWeight: isRoot ? 600 : 400,
                      color: task.completed ? "rgba(255,255,255,0.35)" : isRoot ? "#c7d2fe" : "#e2e8f0",
                      textDecoration: task.completed ? "line-through" : "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                    }}
                  >
                    {task.text}
                  </div>

                  {/* Progress badge */}
                  {totalChildren > 0 && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: completedChildren === totalChildren ? "#22c55e" : "rgba(255,255,255,0.4)",
                        background: "rgba(0,0,0,0.2)",
                        borderRadius: 6,
                        padding: "1px 5px",
                        flexShrink: 0,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {completedChildren}/{totalChildren}
                    </span>
                  )}

                  {/* Add subtask button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onAddSubtask(task.id); }}
                    title="子タスクを追加"
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.2)",
                      color: "rgba(255,255,255,0.5)",
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      flexShrink: 0,
                      fontSize: 14,
                      lineHeight: 1,
                      transition: "all 0.15s",
                      padding: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(100,130,255,0.3)";
                      e.currentTarget.style.borderColor = "rgba(100,130,255,0.8)";
                      e.currentTarget.style.color = "white";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
                      e.currentTarget.style.color = "rgba(255,255,255,0.5)";
                    }}
                  >
                    +
                  </button>
                </div>

                {/* Collapse/expand toggle - positioned outside the node to the right */}
                {hasChildren && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleCollapse(task.id); }}
                    style={{
                      position: "absolute",
                      right: -14,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: isCollapsed ? "rgba(100,130,255,0.3)" : "rgba(30,40,60,0.95)",
                      border: "1px solid rgba(100,130,255,0.5)",
                      color: "rgba(150,180,255,0.9)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      fontSize: 10,
                      fontWeight: 700,
                      zIndex: 10,
                      transition: "all 0.2s",
                      flexShrink: 0,
                      padding: 0,
                    }}
                  >
                    {isCollapsed ? "▶" : "▼"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
