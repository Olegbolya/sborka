'use client';
import { useEffect, useMemo, useState } from 'react';

/** Q-03 · the look of the QR of an access point: colours (with a check), shape of dots and «eyes», own logo, frame with a caption. */
export interface QrStyle {
  fg: string;
  bg: string;
  dots: Shape;
  eyes: Shape;
  logoMediaId: string | null;
  frame: boolean;
  caption: string;
}
type Shape = 'square' | 'rounded' | 'circle';

const SHAPES: Array<{ key: Shape; label: string }> = [
  { key: 'square', label: 'Квадратные' },
  { key: 'rounded', label: 'Скруглённые' },
  { key: 'circle', label: 'Круглые' },
];
const MIN_CONTRAST = 4;
const CSRF = { 'X-Blokum-CSRF': '1', 'Content-Type': 'application/json' };

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => 0.2126 * channel(parseInt(hex.slice(1, 3), 16)) + 0.7152 * channel(parseInt(hex.slice(3, 5), 16)) + 0.0722 * channel(parseInt(hex.slice(5, 7), 16));

/** What the person sees before saving: the same rule the server applies. */
export function colourHint(fg: string, bg: string): string | null {
  if (luminance(fg) >= luminance(bg)) return 'Точки должны быть темнее фона: светлый код на тёмном многие камеры не читают.';
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  const ratio = (hi + 0.05) / (lo + 0.05);
  return ratio < MIN_CONTRAST ? `Слишком мало контраста (${ratio.toFixed(1)} из нужных ${MIN_CONTRAST}): сделайте точки темнее или фон светлее.` : null;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; message?: string };
    throw new Error(body.error?.message ?? body.message ?? `Ошибка ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const hexOf = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null);

const box = { padding: 14, border: '1px solid var(--border, #e5e2dc)', borderRadius: 10, marginTop: 12, display: 'grid', gap: 14 } as const;
const row = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } as const;
const lab = { fontSize: 13, fontWeight: 600 } as const;
const chip = (on: boolean) => ({ padding: '6px 12px', borderRadius: 8, border: `1px solid ${on ? 'var(--accent, #e4572e)' : '#d6d2ca'}`, background: on ? 'var(--accent, #e4572e)' : '#fff', color: on ? '#fff' : 'inherit', fontSize: 13, cursor: 'pointer' }) as const;

export function QrDesigner({ projectId, pointId }: { projectId: string; pointId: string }) {
  const base = `/projects/${projectId}/access-points/${pointId}`;
  const [style, setStyle] = useState<QrStyle | null>(null);
  const [saved, setSaved] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [library, setLibrary] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    call<QrStyle>(`${base}/qr-style`)
      .then((s) => live && setStyle(s))
      .catch((e: Error) => live && setMessage({ kind: 'error', text: e.message }));
    return () => {
      live = false;
    };
  }, [base]);

  const hint = useMemo(() => (style ? colourHint(style.fg, style.bg) : null), [style]);
  if (!style) return <p style={{ fontSize: 13 }}>{message?.text ?? 'Загружаем оформление…'}</p>;
  const set = (patch: Partial<QrStyle>): void => {
    setMessage(null);
    setStyle({ ...style, ...patch });
  };

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      setStyle(await call<QrStyle>(`${base}/qr-style`, { method: 'PUT', headers: CSRF, body: JSON.stringify(style) }));
      setSaved((n) => n + 1);
      setMessage({ kind: 'ok', text: 'Оформление сохранено. Все новые скачивания будут такими.' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function fromTheme(): Promise<void> {
    setMessage(null);
    try {
      const project = await call<{ document?: { theme?: { tokens?: { colors?: Record<string, unknown> } } } }>(`/projects/${projectId}`);
      const colors = project.document?.theme?.tokens?.colors ?? {};
      const fg = hexOf(colors.text) ?? hexOf(colors.primary);
      const bg = hexOf(colors.background) ?? hexOf(colors.surface);
      if (!fg || !bg) {
        setMessage({ kind: 'error', text: 'В теме сборки нет подходящих цветов (нужны цвет текста и фона в формате #RRGGBB).' });
        return;
      }
      setStyle({ ...style!, fg, bg });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  }

  async function openLibrary(): Promise<void> {
    setMessage(null);
    try {
      const page = await call<{ items: Array<{ id: string; kind: string; status: string; mime: string }> }>('/media?kind=IMAGE&limit=60');
      setLibrary(page.items.filter((m) => /^image\/(png|jpeg|webp|gif)$/.test(m.mime) && m.status !== 'BLOCKED' && m.status !== 'REJECTED').map((m) => m.id));
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  }

  return (
    <div style={box} data-testid="qr-designer">
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto' }}>
          {/* The picture is drawn by the server from the saved look, so what is shown is what is downloaded. */}
          <img
            key={saved}
            src={`/api/v1${base}/qr.png?size=1024&v=${saved}`}
            alt="Так выглядит QR-код с сохранённым оформлением"
            width={220}
            style={{ display: 'block', borderRadius: 8, border: '1px solid #e5e2dc', background: '#fff', minHeight: 220 }}
          />
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0', maxWidth: 220 }}>Картинка обновляется после сохранения.</p>
        </div>
        <div style={{ flex: '1 1 260px', display: 'grid', gap: 12 }}>
          <div>
            <div style={lab}>Цвета</div>
            <div style={{ ...row, marginTop: 6 }}>
              <label style={{ fontSize: 13 }}>
                Точки{' '}
                <input type="color" aria-label="Цвет точек" value={style.fg} onChange={(e) => set({ fg: e.target.value })} />
              </label>
              <label style={{ fontSize: 13 }}>
                Фон{' '}
                <input type="color" aria-label="Цвет фона" value={style.bg} onChange={(e) => set({ bg: e.target.value })} />
              </label>
              <button type="button" style={chip(false)} onClick={() => void fromTheme()}>
                Взять цвета из темы сборки
              </button>
            </div>
            {hint && (
              <p role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: '6px 0 0' }}>
                {hint}
              </p>
            )}
          </div>
          <div role="group" aria-label="Форма точек">
            <div style={lab}>Форма точек</div>
            <div style={{ ...row, marginTop: 6 }}>
              {SHAPES.map((o) => (
                <button key={o.key} type="button" aria-pressed={style.dots === o.key} style={chip(style.dots === o.key)} onClick={() => set({ dots: o.key })}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-label="Форма глазков">
            <div style={lab}>Форма «глазков» (три больших квадрата в углах)</div>
            <div style={{ ...row, marginTop: 6 }}>
              {SHAPES.map((o) => (
                <button key={o.key} type="button" aria-pressed={style.eyes === o.key} style={chip(style.eyes === o.key)} onClick={() => set({ eyes: o.key })}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={lab}>Логотип в центре</div>
            <div style={{ ...row, marginTop: 6 }}>
              <button type="button" style={chip(false)} onClick={() => void openLibrary()}>
                {style.logoMediaId ? 'Выбрать другой из медиатеки' : 'Выбрать из медиатеки'}
              </button>
              {style.logoMediaId && (
                <button type="button" style={chip(false)} onClick={() => set({ logoMediaId: null })}>
                  Убрать логотип
                </button>
              )}
            </div>
            {library && (
              <div style={{ ...row, marginTop: 8 }} role="list" aria-label="Картинки из вашей медиатеки">
                {library.length === 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>В медиатеке пока нет картинок. Загрузите их в редакторе сборки.</span>}
                {library.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="listitem"
                    aria-label="Выбрать эту картинку логотипом"
                    aria-pressed={style.logoMediaId === id}
                    onClick={() => {
                      set({ logoMediaId: id });
                      setLibrary(null);
                    }}
                    style={{ padding: 2, border: `2px solid ${style.logoMediaId === id ? 'var(--accent, #e4572e)' : 'transparent'}`, borderRadius: 8, background: '#fff', cursor: 'pointer' }}
                  >
                    <img src={`/api/v1/media/${id}/file`} alt="" width={48} height={48} style={{ objectFit: 'contain', display: 'block' }} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label style={{ ...row, fontSize: 13 }}>
              <input type="checkbox" checked={style.frame} onChange={(e) => set({ frame: e.target.checked })} /> Рамка с подписью
            </label>
            {style.frame && (
              <input
                aria-label="Подпись под QR"
                placeholder="Например: «Пройди сборку — 2 минуты»"
                maxLength={40}
                value={style.caption}
                onChange={(e) => set({ caption: e.target.value })}
                style={{ marginTop: 8, width: '100%', maxWidth: 360, padding: '8px 10px', borderRadius: 8, border: '1px solid #d6d2ca', fontSize: 14 }}
              />
            )}
          </div>
        </div>
      </div>
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} style={{ margin: 0, fontSize: 13, color: message.kind === 'error' ? '#b91c1c' : '#166534' }}>
          {message.text}
        </p>
      )}
      <div style={row}>
        <button type="button" style={{ ...chip(true), padding: '9px 16px', opacity: busy || hint ? 0.5 : 1 }} disabled={busy || hint !== null} onClick={() => void save()}>
          {busy ? 'Проверяем и сохраняем…' : 'Сохранить оформление'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Перед сохранением код проверяется так, как его читает телефон.</span>
      </div>
    </div>
  );
}
