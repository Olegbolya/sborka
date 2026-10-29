'use client';
import { type ReactNode, createContext, useContext, useEffect, useRef } from 'react';

/** Inside a window the canvas is covered: a field cannot ask it for a block there (SC-02). */
const InDialog = createContext(false);
export const useInDialog = (): boolean => useContext(InDialog);

/** A modal window: closes with Escape (when allowed), keeps the keyboard inside, gives the focus back on close. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]') ?? [])].filter((el) => !el.hasAttribute('disabled'));
    (focusables()[0] ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0]!;
        const last = list[list.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="ed-backdrop">
      <div ref={ref} className="ed-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} style={wide ? { width: 'min(1000px, 100%)' } : { width: 'min(460px, 100%)' }}>
        <h2>{title}</h2>
        <InDialog.Provider value>{children}</InDialog.Provider>
      </div>
    </div>
  );
}
