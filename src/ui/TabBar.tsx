import { useRef, useState } from 'react';
import type { OscillatorTab } from '../engine/oscillator';

interface TabBarProps {
  tabs: OscillatorTab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onReorder: (tabs: OscillatorTab[]) => void;
}

export function TabBar({ tabs, activeTabId, onSelect, onAdd, onRemove, onRename, onReorder }: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const dragSrc = useRef<number | null>(null);

  const startEdit = (tab: OscillatorTab) => {
    setEditingId(tab.id);
    setEditValue(tab.label);
  };

  const commitEdit = (id: string) => {
    const trimmed = editValue.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
  };

  const handleDragStart = (idx: number) => { dragSrc.current = idx; };

  const handleDrop = (idx: number) => {
    const src = dragSrc.current;
    if (src === null || src === idx) return;
    const next = [...tabs];
    const [moved] = next.splice(src, 1);
    next.splice(idx, 0, moved);
    onReorder(next);
    dragSrc.current = null;
  };

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-neutral-800 overflow-x-auto shrink-0">
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(idx)}
            onClick={() => onSelect(tab.id)}
            className={`
              flex items-center gap-1.5 px-2 py-1 text-xs border rounded-sm cursor-pointer shrink-0 select-none
              transition-colors duration-100
              ${isActive
                ? 'border-neutral-600 bg-neutral-800 text-neutral-100'
                : 'border-transparent text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900'
              }
            `}
          >
            {/* Color dot */}
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: tab.color, boxShadow: isActive ? `0 0 6px ${tab.color}` : 'none' }}
            />

            {/* Label / edit input */}
            {editingId === tab.id ? (
              <input
                autoFocus
                className="bg-transparent border-b border-neutral-400 outline-none w-16 text-xs text-neutral-100"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitEdit(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(tab.id);
                  if (e.key === 'Escape') setEditingId(null);
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="font-mono tracking-wider"
                onDoubleClick={(e) => { e.stopPropagation(); startEdit(tab); }}
              >
                {tab.label}
              </span>
            )}

            {/* Muted indicator */}
            {tab.isMuted && (
              <span className="text-yellow-500 text-xs leading-none">M</span>
            )}
            {tab.solo && (
              <span style={{ color: tab.color }} className="text-xs leading-none font-bold">S</span>
            )}

            {/* Close button — only show when more than one tab */}
            {tabs.length > 1 && (
              <button
                className="ml-0.5 text-neutral-600 hover:text-red-400 transition-colors leading-none"
                onClick={(e) => { e.stopPropagation(); onRemove(tab.id); }}
                title="Remove oscillator"
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {/* Add tab button */}
      <button
        onClick={onAdd}
        className="px-2 py-1 text-xs text-neutral-600 hover:text-neutral-300 border border-transparent hover:border-neutral-700 rounded-sm transition-colors shrink-0"
        title="Add oscillator"
      >
        + OSC
      </button>
    </div>
  );
}
