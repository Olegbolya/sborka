'use client';
import { PassOffer } from '../billing/PassOffer';
import { Dialog } from './Dialog';

/** P7.1 · публикацию остановил лимит тарифа: что именно не проходит и как включить «Праздник» для этой сборки. */
export function PassDialog({ projectId, reasons, onClose }: { projectId: string; reasons: string[]; onClose: () => void }) {
  return (
    <Dialog title="Для публикации нужен тариф" onClose={onClose}>
      <p className="ed-hint" style={{ margin: '0 0 8px' }}>
        Сборку можно собирать и проверять бесплатно, а опубликовать её не дают границы тарифа «Старт»:
      </p>
      <PassOffer projectId={projectId} reasons={reasons} />
      <div className="row">
        <button type="button" className="ed-btn" data-testid="pass-close" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Dialog>
  );
}
