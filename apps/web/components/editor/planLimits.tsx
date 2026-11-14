'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api-browser';
import { useEnv } from './context';
import { PassDialog } from './PassDialog';

/** P7.1 · границы тарифа этой сборки, которые редактор показывает при работе (04-TARIFFS §2). */
export interface ProjectLimits {
  plan: { code: string; title: string };
  screens: number;
  rules: number;
}

/** Лимиты сборки: читаются один раз и заново — когда человек возвращается в окно (например, после оплаты). */
export function useProjectLimits(): ProjectLimits | null {
  const { projectId } = useEnv();
  const [limits, setLimits] = useState<ProjectLimits | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      api<ProjectLimits>(`/projects/${projectId}/limits`)
        .then((r) => active && setLimits(r))
        .catch(() => undefined);
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [projectId]);
  return limits;
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
