import { create } from 'zustand';
import type { SceneDoc, SceneObject } from '../../shared/types';

const MAX_HISTORY = 100;

interface EditorState {
  officeId: string | null;
  doc: SceneDoc | null;
  version: number;
  /** JSON da última versão gravada (para saber se há alterações não salvas). */
  savedJson: string;
  past: SceneObject[][];
  future: SceneObject[][];
  selected: string[];
  /** Instantâneo do início de uma alteração contínua (arraste): vira UM passo no histórico. */
  transientBase: SceneObject[] | null;
  load(officeId: string, doc: SceneDoc, version: number): void;
  /** Aplica uma alteração com histórico. `fn` devolve a nova lista (ou null para não fazer nada). */
  apply(fn: (objects: SceneObject[]) => SceneObject[] | null, select?: string[]): void;
  beginTransient(): void;
  setTransient(objects: SceneObject[]): void;
  commitTransient(objects?: SceneObject[]): void;
  cancelTransient(): void;
  undo(): void;
  redo(): void;
  select(ids: string[]): void;
  markSaved(version: number, doc?: SceneDoc): void;
}

export const useEditor = create<EditorState>((set, get) => ({
  officeId: null,
  doc: null,
  version: 0,
  savedJson: '',
  past: [],
  future: [],
  selected: [],
  transientBase: null,
  load: (officeId, doc, version) => set({ officeId, doc, version, savedJson: JSON.stringify(doc), past: [], future: [], selected: [], transientBase: null }),
  apply: (fn, select) => {
    const { doc, past } = get();
    if (!doc) return;
    const next = fn(doc.objects);
    if (!next || next === doc.objects) return;
    set({ doc: { ...doc, objects: next }, past: [...past, doc.objects].slice(-MAX_HISTORY), future: [], ...(select ? { selected: select } : {}) });
  },
  beginTransient: () => {
    const { doc } = get();
    if (doc) set({ transientBase: doc.objects });
  },
  setTransient: (objects) => {
    const { doc } = get();
    if (doc) set({ doc: { ...doc, objects } });
  },
  commitTransient: (objects) => {
    const { doc, transientBase, past } = get();
    if (!doc || !transientBase) return;
    const final = objects ?? doc.objects;
    const changed = JSON.stringify(final) !== JSON.stringify(transientBase);
    set({ doc: { ...doc, objects: final }, transientBase: null, ...(changed ? { past: [...past, transientBase].slice(-MAX_HISTORY), future: [] } : {}) });
  },
  cancelTransient: () => {
    const { doc, transientBase } = get();
    if (doc && transientBase) set({ doc: { ...doc, objects: transientBase }, transientBase: null });
  },
  undo: () => {
    const { doc, past, future, selected } = get();
    if (!doc || !past.length) return;
    const prev = past[past.length - 1];
    const ids = new Set(prev.map((o) => o.id));
    set({ doc: { ...doc, objects: prev }, past: past.slice(0, -1), future: [doc.objects, ...future], selected: selected.filter((id) => ids.has(id)) });
  },
  redo: () => {
    const { doc, past, future, selected } = get();
    if (!doc || !future.length) return;
    const next = future[0];
    const ids = new Set(next.map((o) => o.id));
    set({ doc: { ...doc, objects: next }, past: [...past, doc.objects], future: future.slice(1), selected: selected.filter((id) => ids.has(id)) });
  },
  select: (ids) => set({ selected: ids }),
  markSaved: (version, doc) => {
    const cur = doc ?? get().doc;
    set({ version, savedJson: JSON.stringify(cur) });
  },
}));

// diagnóstico em desenvolvimento: os testes no navegador leem o estado do editor
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __office3dEditor?: typeof useEditor }).__office3dEditor = useEditor;

export const isDirty =(s: Pick<EditorState, 'doc' | 'savedJson'>) => !!s.doc && JSON.stringify(s.doc) !== s.savedJson;
