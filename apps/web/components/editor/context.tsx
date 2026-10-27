'use client';
import { type ReactNode, createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { type EditorActions, type EditorState, type EditorStore } from '../../lib/editor/store';
import { type MediaCatalog } from '../../lib/editor/media';
import { type Saver } from '../../lib/editor/saver';

/** What the controls need: the store (gestures, values) and the files of the library. The theme editor provides only this. */
export interface ControlEnv {
  store: EditorStore;
  /** Files of the creator's library, for fills and the like. */
  media: MediaCatalog;
}

export interface EditorEnv extends ControlEnv {
  saver: Saver;
  projectId: string;
  /** Shows a short message under the top bar. */
  flash: (message: string, kind?: 'ok' | 'error') => void;
  /** Puts a document from the server into the editor: nothing is saved back, the history starts anew. */
  loadDocument: (doc: EditorState['doc']) => void;
}

const Ctx = createContext<ControlEnv | null>(null);

export function EditorProvider({ value, children }: { value: ControlEnv | EditorEnv; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Store and media only: works in the editor of a project and in the editor of a theme. */
export function useControlEnv(): ControlEnv {
  const env = useContext(Ctx);
  if (!env) throw new Error('Редактор не подключён');
  return env;
}

/** The whole environment of the project editor (saving, history, messages). */
export function useEnv(): EditorEnv {
  const env = useContext(Ctx);
  if (!env || !('saver' in env)) throw new Error('Редактор не подключён');
  return env as EditorEnv;
}

/** Selector over the editor store; select primitives or stable references only. */
export function useEditor<T>(selector: (state: EditorState & EditorActions) => T): T {
  return useStore(useControlEnv().store, selector);
}
