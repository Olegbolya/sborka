'use client';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useState } from 'react';
import { errorText } from '../../lib/api-browser';

/** Small building blocks shared by the pages of the admin (P9.3): the same look, Russian texts only. */
export const css = {
  page: { maxWidth: 1100, margin: '0 auto', padding: '24px 16px 64px' } satisfies CSSProperties,
  h1: { fontSize: 'clamp(22px, 4vw, 28px)', margin: '0 0 16px', letterSpacing: '-0.02em' } satisfies CSSProperties,
  h2: { fontSize: 18, margin: '28px 0 10px' } satisfies CSSProperties,
  card: { padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border, #ddd)', marginBottom: 10 } satisfies CSSProperties,
  row: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } satisfies CSSProperties,
  muted: { color: 'var(--muted)', fontSize: 13 } satisfies CSSProperties,
  input: { padding: '8px 12px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ccc)', background: 'transparent', color: 'inherit', font: 'inherit', minWidth: 0 } satisfies CSSProperties,
  btn: { padding: '8px 16px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' } satisfies CSSProperties,
  btnLight: { padding: '8px 16px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border, #ccc)', cursor: 'pointer', background: 'transparent', color: 'inherit' } satisfies CSSProperties,
  btnDanger: { padding: '8px 16px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: '#dc2626', color: '#fff' } satisfies CSSProperties,
  error: { padding: '10px 14px', borderRadius: 8, background: '#dc262618', color: '#dc2626', fontSize: 14, margin: '0 0 12px' } satisfies CSSProperties,
  ok: { padding: '10px 14px', borderRadius: 8, background: '#16a34a18', color: '#16a34a', fontSize: 14, margin: '0 0 12px' } satisfies CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 } satisfies CSSProperties,
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid var(--border, #ddd)', fontWeight: 600, whiteSpace: 'nowrap' } satisfies CSSProperties,
  td: { padding: '8px 10px', borderBottom: '1px solid var(--border, #eee)', verticalAlign: 'top' } satisfies CSSProperties,
};

export function Badge({ color, children }: { color: string; children: ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: `${color}22`, color, whiteSpace: 'nowrap' }}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, flex: '1 1 220px', minWidth: 0 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
    </label>
  );
}

export function Notice({ error, ok }: { error?: string; ok?: string }) {
  return (
    <>
      {error ? <p role="alert" style={css.error}>{error}</p> : null}
      {ok ? <p role="status" style={css.ok}>{ok}</p> : null}
    </>
  );
}

/** Loads something on mount and when `reload` is called; the error is shown in Russian. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is a new function on every render; the caller names what it depends on in `deps`
  const run = useCallback(load, deps);
  useEffect(() => {
    let active = true;
    run()
      .then((d) => {
        if (active) {
          setData(d);
          setError('');
        }
      })
      .catch((e: unknown) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [run, tick]);
  return { data, error, reload: () => setTick((n) => n + 1) };
}

/** Runs an action, tells whether it worked, and reloads the page's data afterwards. */
export function useAction(after?: () => void): { busy: boolean; error: string; ok: string; run: (fn: () => Promise<unknown>, done?: string) => Promise<boolean> } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const run = async (fn: () => Promise<unknown>, done = 'Готово'): Promise<boolean> => {
    setBusy(true);
    setError('');
    setOk('');
    try {
      await fn();
      setOk(done);
      after?.();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, ok, run };
}
