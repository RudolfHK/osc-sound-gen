import { useEffect, useRef } from 'react';
import { Oscilloscope } from '../visualizer/oscilloscope';
import { ControlPanel } from './controls';
import { THEME_COLORS } from '../utils/math';
import type { OscillatorState, AdvancedSettings } from '../engine/oscillator';

interface LayoutProps {
  state: OscillatorState;
  advanced: AdvancedSettings;
  onStateChange: (s: OscillatorState) => void;
  onAdvancedChange: (a: AdvancedSettings) => void;
  onTogglePlay: () => void;
}

export function Layout({ state, advanced, onStateChange, onAdvancedChange, onTogglePlay }: LayoutProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scopeRef = useRef<Oscilloscope | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize oscilloscope
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scope = new Oscilloscope(canvas, state, advanced);
    scopeRef.current = scope;

    // Set initial canvas size
    const container = canvas.parentElement;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }
    scope.start();

    return () => {
      scope.stop();
      scopeRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push state updates to oscilloscope every render
  useEffect(() => {
    scopeRef.current?.setState(state, advanced);
  }, [state, advanced]);

  // Resize handler
  useEffect(() => {
    const container = canvasRef.current?.parentElement;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        scopeRef.current?.resize(Math.round(width), Math.round(height));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const themeColor = THEME_COLORS[advanced.colorTheme];

  return (
    <div ref={containerRef} className="flex flex-col h-screen bg-[#0a0a0a] select-none">
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 shrink-0"
        style={{ borderBottomColor: themeColor + '33' }}
      >
        <div className="flex items-center gap-3">
          {/* Inline SVG logo */}
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polyline
              points="2,16 6,16 8,6 10,26 12,6 14,26 16,16 30,16"
              stroke={themeColor}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <h1 className="text-sm font-bold uppercase tracking-widest" style={{ color: themeColor }}>
            OSC
          </h1>
          <span className="text-xs text-neutral-600 tracking-widest">
            DIGITAL OSCILLATOR SYNTHESIZER
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <span
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: state.isPlaying ? '#00ff88' : '#333',
              boxShadow: state.isPlaying ? '0 0 6px #00ff88' : 'none',
            }}
          />
          <span>{state.isPlaying ? 'PLAYING' : 'STOPPED'}</span>
        </div>
      </header>

      {/* Oscilloscope display */}
      <div className="flex-1 relative min-h-0">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: 'auto' }}
        />
      </div>

      {/* Controls */}
      <div className="shrink-0">
        <ControlPanel
          state={state}
          advanced={advanced}
          onStateChange={onStateChange}
          onAdvancedChange={onAdvancedChange}
          onTogglePlay={onTogglePlay}
        />
      </div>
    </div>
  );
}
