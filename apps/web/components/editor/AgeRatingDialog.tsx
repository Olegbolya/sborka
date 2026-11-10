'use client';
import { useState } from 'react';
import { api, errorText } from '../../lib/api-browser';
import { AgeRatingPicker } from '../shared/AgeRatingPicker';
import { Dialog } from './Dialog';

/** P8.7 · a work cannot be published without an age category, so the choice opens by itself on «Опубликовать» (PL-09). */
export function AgeRatingDialog({ projectId, onChosen, onClose }: { projectId: string; onChosen: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (rating: 0 | 6 | 12 | 16 | 18): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${encodeURIComponent(projectId)}/access-settings`, { method: 'PATCH', body: { ageRating: rating } });
      onChosen();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Для кого эта сборка?" onClose={onClose}>
      <p className="ed-hint" style={{ margin: '0 0 12px' }}>
        Перед публикацией нужно выбрать возрастную категорию. Её можно поменять потом в кабинете: «Ответы и доступ».
      </p>
      <AgeRatingPicker value={null} disabled={busy} onPick={(r) => void pick(r)} />
      {error && (
        <p role="alert" className="ed-hint" style={{ color: '#b91c1c' }}>
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="ed-btn" data-testid="age-close" onClick={onClose}>
          Отмена
        </button>
      </div>
    </Dialog>
  );
}
