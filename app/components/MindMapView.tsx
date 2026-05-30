"use client";

import React, { useState, useEffect, useRef } from "react";
import type { Task } from "../page";

interface MindMapViewProps {

  tasks: Task[];
  rootTaskId: string;
  onClose: () => void;
  onToggleComplete: (id: string) => void;
  onOpenEdit: (task: Task) => void;
  onAddSubtask: (parentId: string) => void;
}

export default function MindMapView({
  tasks,
  rootTaskId,
  onClose,
  onToggleComplete,
  onOpenEdit,
  onAddSubtask,
}: MindMapViewProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Center the view on load
  useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      container.scrollLeft = 0;
      container.scrollTop = (container.scrollHeight - container.clientHeight) / 2;
    }
  }, []);

  const toggleCollapse = (id: string) => {
    setCollapsedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const renderNode = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return null;

    const children = tasks.filter(t => t.parentId === taskId);
    const hasChildren = children.length > 0;
    const isCollapsed = collapsedIds.has(taskId);

    return (
      <div key={taskId} className="mindmap-node-wrapper">
        <div className="mindmap-node-content">
          <div className="mindmap-node-card">
            {/* Completion Checkbox */}
            <div 
              className={`mindmap-checkbox ${task.completed ? 'completed' : ''}`}
              onClick={() => onToggleComplete(task.id)}
            >
              {task.completed && <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>}
            </div>

            {/* Task text (Click to Edit) */}
            <div 
              className={`mindmap-task-text ${task.completed ? 'completed-text' : ''}`}
              onClick={() => onOpenEdit(task)}
              title="編集する"
            >
              {task.text}
            </div>

            {/* Priority dot / Category if needed can be added here */}

            {/* Add subtask button */}
            <button 
              className="mindmap-add-btn" 
              onClick={(e) => { e.stopPropagation(); onAddSubtask(task.id); }}
              title="子タスクを追加"
            >
              ＋
            </button>
          </div>

          {/* Toggle children button */}
          {hasChildren && (
            <button 
              className={`mindmap-toggle-btn ${isCollapsed ? 'collapsed' : ''}`}
              onClick={() => toggleCollapse(taskId)}
            >
              {isCollapsed ? '+' : '-'}
            </button>
          )}
        </div>

        {/* Children Column */}
        {hasChildren && !isCollapsed && (
          <div className="mindmap-children-column">
            {children.map(child => renderNode(child.id))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mindmap-overlay">
      <div className="mindmap-header">
        <div className="mindmap-title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          マインドマップ・ツリービュー
        </div>
        <button className="mindmap-close-btn" onClick={onClose}>
          × リスト表示に戻る
        </button>
      </div>

      <div className="mindmap-container" ref={containerRef}>
        <div className="mindmap-canvas">
          {renderNode(rootTaskId)}
        </div>
      </div>
    </div>
  );
}
