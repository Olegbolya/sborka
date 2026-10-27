'use client';
import { type MediaRef } from '@blokum/schema';
import { useState, useSyncExternalStore } from 'react';
import { errorText, upload } from '../../lib/api-browser';
import { type MediaItem, type MediaKind, mediaUrl } from '../../lib/editor/media';
import { Dialog } from './Dialog';
import { useControlEnv } from './context';

const KIND_TITLES: Record<MediaKind, string> = { IMAGE: 'Фото', GIF: 'GIF', VIDEO: 'Видео', AUDIO: 'Звук', LOTTIE: 'Анимация', FONT_SOURCE: 'Шрифт' };

/** Files of the creator's library; a new one can be uploaded right here. */
export function MediaPicker({ kinds, onPick, onClose }: { kinds: readonly MediaKind[]; onPick: (ref: MediaRef) => void; onClose: () => void }) {
  const { media } = useControlEnv();
  useSyncExternalStore(media.subscribe, media.getSnapshot, media.getSnapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = media.items(kinds);

  const send = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const made = await upload<MediaItem>('/media', form);
      media.add({ ...made, createdAt: String(made.createdAt) });
      onPick({ source: 'media', id: made.id });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Выбор файла" onClose={onClose} wide>
      {error && (
        <p role="alert" className="ed-banner" style={{ marginBottom: 10 }}>
          {error}
        </p>
      )}
      <label className="ed-btn primary" style={{ alignSelf: 'flex-start', cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Загружаем…' : 'Загрузить файл'}
        <input
          type="file"
          aria-label="Загрузить файл"
          accept="image/*,video/*"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void send(f);
          }}
        />
      </label>
      {items.length === 0 ? (
        <p className="ed-hint" style={{ marginTop: 12 }}>
          В медиатеке пока нет подходящих файлов — загрузите первый.
        </p>
      ) : (
        <ul className="ed-list ed-media" aria-label="Файлы медиатеки" style={{ marginTop: 12 }}>
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" className="ed-item ed-mediaitem" data-media-id={m.id} onClick={() => onPick({ source: 'media', id: m.id })}>
                {m.kind === 'IMAGE' ? <img src={mediaUrl(m.id)} alt="" width={64} height={64} style={{ objectFit: 'cover', borderRadius: 6 }} /> : <span className="ed-mediakind">{KIND_TITLES[m.kind]}</span>}
                <span className="name">
                  {KIND_TITLES[m.kind]} · {m.width && m.height ? `${m.width}×${m.height}` : `${Math.max(1, Math.round(m.bytes / 1024))} КБ`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button type="button" className="ed-btn" onClick={onClose}>
          Отмена
        </button>
      </div>
    </Dialog>
  );
}

/** A field that holds a reference to a file: shows it and opens the library. */
export function MediaField({ control, label, value, kinds, onChange }: { control: string; label: string; value: MediaRef | null; kinds: readonly MediaKind[]; onChange: (ref: MediaRef) => void }) {
  const [open, setOpen] = useState(false);
  const known = value && value.source === 'media' && value.id !== 'media_unset';
  return (
    <div className="ed-field" data-control={control}>
      <span>{label}</span>
      <div className="ed-colorrow">
        {known && <img src={mediaUrl(value.id)} alt="" width={32} height={32} style={{ objectFit: 'cover', borderRadius: 4 }} onError={(e) => ((e.currentTarget).style.display = 'none')} />}
        <button type="button" className="ed-btn small" onClick={() => setOpen(true)}>
          {known ? 'Заменить файл' : 'Выбрать файл'}
        </button>
      </div>
      {open && (
        <MediaPicker
          kinds={kinds}
          onClose={() => setOpen(false)}
          onPick={(ref) => {
            onChange(ref);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
