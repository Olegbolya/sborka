'use client';
import { type ReactNode, createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { type EditorActions, type EditorState, type EditorStore } from '../../lib/editor/store';
import { type Saver } from '../../lib/editor/saver';

export interface EditorEnv {
  store: EditorStore;
  saver: Saver;
  projectId: string;
  /** Shows a short message under the top bar. */
  flash: (message: string, kind?: 'ok' | 'error') => void;
  /** Puts a document from the server into the editor: nothing is saved back, the history starts anew. */
  loadDocument: (doc: EditorState['doc']) => void;
}

const Ctx = createContext<EditorEnv | null>(null);

export function EditorProvider({ value, children }: { value: EditorEnv; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEnv(): EditorEnv {
  const env = useContext(Ctx);
  if (!env) throw new Error('Редактор не подключён');
  return env;
}

/** Selector over the editor store; select primitives or stable references only. */
export function useEditor<T>(selector: (state: EditorState & EditorActions) => T): T {
  return useStore(useEnv().store, selector);
}
