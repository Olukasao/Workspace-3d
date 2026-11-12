import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import type { ActionState } from '../shared/types';

export function Dialog({ title, onClose, children, footer, wide, badge }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; badge?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose costuma ser uma função nova a cada renderização do pai (ex.: evento de presença ao vivo);
  // o foco inicial e o Esc ficam num efeito de montagem para não roubar o foco de quem está digitando.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2 style={{ flex: 1 }}>{title}</h2>
          {badge}
          <button className="btn icon ghost" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export const DemoBadge = ({ mode }: { mode: 'demo' | 'real' }) => (mode === 'demo' ? <span className="chip demo">Simulação (demonstração)</span> : <span className="chip info">Serviço real</span>);

const STATE_LABEL: Record<ActionState['state'], string> = { available: 'Disponível', not_configured: 'Não configurado', forbidden: 'Sem permissão', unavailable: 'Indisponível' };
const STATE_CLASS: Record<ActionState['state'], string> = { available: 'ok', not_configured: 'neutral', forbidden: 'warn', unavailable: 'bad' };
export const ActionChip = ({ state }: { state: ActionState['state'] }) => <span className={`chip ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>;

interface ToastState {
  text: string | null;
  show(text: string): void;
}
let timer: ReturnType<typeof setTimeout> | undefined;
export const useToast = create<ToastState>((set) => ({
  text: null,
  show: (text) => {
    clearTimeout(timer);
    set({ text });
    timer = setTimeout(() => set({ text: null }), 4500);
  },
}));
export const toast = (text: string) => useToast.getState().show(text);

export function Toast() {
  const text = useToast((s) => s.text);
  return text ? (
    <div className="toast" role="status" aria-live="polite">
      {text}
    </div>
  ) : null;
}

/** Campo numérico que só confirma ao sair/Enter (não grava a cada tecla). */
export function NumberField({ label, value, step = 0.05, min, max, onChange, suffix, disabled }: { label: string; value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void; suffix?: string; disabled?: boolean }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const v = Number(text.replace(',', '.'));
    if (!Number.isFinite(v)) return setText(fmt(value));
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (c !== value) onChange(c);
    setText(fmt(c));
  };
  return (
    <label className="field">
      <span>
        {label}
        {suffix ? ` (${suffix})` : ''}
      </span>
      <input
        className="input"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value + (e.key === 'ArrowUp' ? step : -step)));
            onChange(Math.round(v * 1000) / 1000);
          }
        }}
      />
    </label>
  );
}
const fmt = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',');

export const dateTime = (ms: number) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
