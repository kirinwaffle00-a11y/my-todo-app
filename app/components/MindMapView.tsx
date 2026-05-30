"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { Task } from "../page";

interface MindMapViewProps {
  tasks: Task[];
  rootTaskId: string;
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
  rootTaskId,
  onClose,
  onToggleComplete,
  onOpenEdit,
  onAddSubtask,
}: MindMapViewProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [canvasSize, setCanvasSize] = useState({ width: 2000, height: 1200 });
  const [pan, setPan] = useState({ x: 60, y: 0 }); // initial pan offset
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
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
  const rootNode = buildTree(rootTaskId, tasks, collapsedIds, 0);
  let allNodes: LayoutNode[] = [];
  let edges: Array<{ from: LayoutNode; to: LayoutNode }> = [];
  let totalHeight = 800;

  if (rootNode) {
    assignY(rootNode, 0);
    allNodes = flattenTree(rootNode);
    edges = collectEdges(rootNode);
    totalHeight = Math.max(800, rootNode.height + 80);
  }

  // Recalculate canvas size
  useEffect(() => {
    if (allNodes.length === 0) return;
    const maxX = Math.max(...allNodes.map((n) => n.x + n.width));
    const maxY = Math.max(...allNodes.map((n) => n.y + NODE_HEIGHT));
    setCanvasSize({ width: maxX + 100, height: Math.max(maxY + 100, 600) });
    // Center vertically
    if (containerRef.current && rootNode) {
      const midY = rootNode.y + NODE_HEIGHT / 2;
      const containerH = containerRef.current.clientHeight;
      setPan((p) => ({ ...p, y: containerH / 2 - midY }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedIds, tasks, rootTaskId]);

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

  // Touch pan handlers (mobile)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest(".mm-node")) return;
    const t = e.touches[0];
    setIsPanning(true);
    panStart.current = { mouseX: t.clientX, mouseY: t.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPanning) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - panStart.current.mouseX;
    const dy = t.clientY - panStart.current.mouseY;
    setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
  }, [isPanning]);

  const onTouchEnd = useCallback(() => setIsPanning(false), []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(7, 11, 22, 0.97)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "inherit",
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 28px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          flexShrink: 0,
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#7c8ff0", fontWeight: 700, fontSize: "1.05rem" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3" /><line x1="12" y1="8" x2="12" y2="12" />
            <circle cx="5" cy="19" r="3" /><line x1="7.5" y1="17.5" x2="11" y2="13" />
            <circle cx="19" cy="19" r="3" /><line x1="16.5" y1="17.5" x2="13" y2="13" />
          </svg>
          タスクツリービュー
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.3)", alignSelf: "center" }}>
            ドラッグでパン ・ ノードをクリックして編集
          </span>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.18)",
              color: "#e2e8f0",
              padding: "8px 18px",
              borderRadius: 20,
              fontSize: "0.875rem",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
          >
            ← リストに戻る
          </button>
        </div>
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
            const isRoot = task.id === rootTaskId;
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
