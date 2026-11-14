'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api-browser';
import { useEnv, useOptionalEnv } from './context';
import { PassDialog } from './PassDialog';

/** P7.1 · границы тарифа этой сборки, которые редактор показывает при работе (04-TARIFFS §2). */
export interface ProjectLimits {
  plan: { code: string; title: string };
  screens: number;
  rules: number;
  /** Поведения тарифа: `all` или список видов. */
  behaviors: 'all' | string[];
  premiumTransitions: boolean;
  audio: boolean;
  contacts: boolean;
}

const PREMIUM_TRANSITIONS = new Set(['flip', 'blinds', 'particles', 'page', 'preset']);
export const LOCK = ' 🔒';
const LOCK_HINT = 'Собирать и проверять можно бесплатно, а опубликовать сборку с этим — на платном тарифе (или с пропуском «Праздник»).';

const cache = new Map<string, { at: number; request: Promise<ProjectLimits | null> }>();
/** Одна загрузка на всех: панели редактора спрашивают границы одновременно. */
function fetchLimits(projectId: string, force: boolean): Promise<ProjectLimits | null> {
  const hit = cache.get(projectId);
  if (!force && hit && Date.now() - hit.at < 5000) return hit.request;
  const request = api<ProjectLimits>(`/projects/${projectId}/limits`).catch(() => null);
  cache.set(projectId, { at: Date.now(), request });
  return request;
}

/** Лимиты сборки: читаются один раз и заново — когда человек возвращается в окно (например, после оплаты). Вне редактора сборки — `null`. */
export function useProjectLimits(): ProjectLimits | null {
  const projectId = useOptionalEnv()?.projectId ?? null;
  const [limits, setLimits] = useState<ProjectLimits | null>(null);
  useEffect(() => {
    if (!projectId) return undefined;
    let active = true;
    const load = (force: boolean) => void fetchLimits(projectId, force).then((r) => active && r && setLimits(r));
    load(false);
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [projectId]);
  return limits;
}

/** Замки платных возможностей: что закрыто на тарифе сборки. Пока границы не прочитаны, ничего не помечается. */
export function usePlanLocks(): {
  transition: (kind: string) => boolean;
  behavior: (kind: string) => boolean;
  block: (type: string) => boolean;
  mark: (title: string, locked: boolean) => string;
  hint: string;
} {
  const l = useProjectLimits();
  return {
    transition: (kind) => l !== null && !l.premiumTransitions && PREMIUM_TRANSITIONS.has(kind),
    behavior: (kind) => l !== null && l.behaviors !== 'all' && !l.behaviors.includes(kind),
    block: (type) => l !== null && ((type === 'audio' && !l.audio) || (type === 'contacts' && !l.contacts)),
    mark: (title, locked) => (locked ? `${title}${LOCK}` : title),
    hint: LOCK_HINT,
  };
}

/** «Занято N из M»; у границы — замок и кнопка, которая объясняет, как её снять. */
export function LimitNote({ used, max, what, planTitle, testId }: { used: number; max: number; what: string; planTitle: string; testId: string }) {
  const { projectId } = useEnv();
  const [open, setOpen] = useState(false);
  const full = used >= max;
  return (
    <p className="ed-hint" data-testid={testId} role={full ? 'status' : undefined}>
      {full ? '🔒 ' : ''}
      {what}: {used} из {max} на тарифе «{planTitle}».{' '}
      {full && (
        <button type="button" className="ed-btn small" data-testid={`${testId}-more`} onClick={() => setOpen(true)}>
          Снять ограничение
        </button>
      )}
      {open && <PassDialog projectId={projectId} title="Предел тарифа" intro="Вы дошли до границы вашего тарифа. Чтобы продолжить, включите «Праздник» для этой сборки или оформите подписку:" reasons={[`На тарифе «${planTitle}» ${what.toLowerCase()} — не больше ${max}.`]} onClose={() => setOpen(false)} />}
    </p>
  );
}
