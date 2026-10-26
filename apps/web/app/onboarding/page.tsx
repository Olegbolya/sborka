'use client';
import { useEffect, useState } from 'react';
import { api, errorText, isApiError } from '../../lib/api-browser';

const s = {
  main: { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '32px 16px' },
  card: { maxWidth: 480, width: '100%' },
  heading: { fontSize: 'clamp(24px, 5vw, 36px)', lineHeight: 1.2, margin: '0 0 8px', letterSpacing: '-0.02em' },
  sub: { fontSize: 15, color: 'var(--muted)', margin: '0 0 32px', lineHeight: 1.5 },
  list: { listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column' as const, gap: 16 },
  item: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  checkbox: { width: 20, height: 20, flexShrink: 0, marginTop: 2, cursor: 'pointer', accentColor: 'var(--accent)' },
  label: { fontSize: 15, lineHeight: 1.5, cursor: 'pointer' },
  link: { color: 'var(--accent)', textDecoration: 'underline' },
  optional: { fontSize: 13, color: 'var(--muted)' },
  btn: {
    display: 'block',
    width: '100%',
    padding: '14px 0',
    fontSize: 16,
    fontWeight: 600,
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    background: 'var(--accent)',
    color: '#fff',
    transition: 'opacity 0.15s',
  } as React.CSSProperties,
  error: { margin: '0 0 16px', padding: '12px 14px', borderRadius: 10, border: '1px solid #dc2626', color: '#b91c1c', fontSize: 14, lineHeight: 1.5 },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' } as React.CSSProperties,
};

interface PendingDocument {
  id: string;
  type: string;
  version: number;
  title: string;
}

interface OnboardingStatus {
  completed: boolean;
  pending: PendingDocument[];
}

interface LegalDocument {
  id: string;
}

/** A-02: the first sign-in. Required: terms, personal-data consent, age. Optional: marketing messages. */
export default function OnboardingPage() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [marketingDocId, setMarketingDocId] = useState<string | null>(null);
  const [tos, setTos] = useState(false);
  const [pd, setPd] = useState(false);
  const [age, setAge] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const st = await api<OnboardingStatus>('/auth/onboarding');
        if (st.completed) {
          window.location.replace('/cabinet/projects');
          return;
        }
        const marketingDoc = await api<LegalDocument>('/legal/documents/marketing').catch(() => null);
        if (cancelled) return;
        setPending(st.pending);
        setMarketingDocId(marketingDoc?.id ?? null);
        setStatus('ready');
      } catch (e) {
        if (isApiError(e) && e.status === 401) {
          window.location.replace('/login');
          return;
        }
        if (cancelled) return;
        setError(errorText(e));
        setStatus('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const needTos = pending.some((d) => d.type === 'TOS');
  const needPd = pending.some((d) => d.type === 'PD_CONSENT_USER');
  const canContinue = status === 'ready' && (!needTos || tos) && (!needPd || pd) && age && !saving;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api('/auth/onboarding/consent', {
        method: 'POST',
        body: {
          documentIds: pending.map((d) => d.id),
          ageConfirmed: age,
          ...(marketing && marketingDocId ? { marketingConsentDocId: marketingDocId } : {}),
        },
      });
      window.location.assign('/cabinet/projects');
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <main style={s.main}>
      <div style={s.card}>
        <h1 style={s.heading}>Перед началом</h1>
        <p style={s.sub}>Прочитайте и подтвердите условия использования сервиса.</p>
        {error && (
          <p role="alert" style={s.error}>
            {error}
          </p>
        )}
        {status === 'loading' && <p style={s.sub}>Загружаем…</p>}
        {status === 'ready' && (
          <>
            <ul style={s.list}>
              {needTos && (
                <li style={s.item}>
                  <input id="tos" type="checkbox" style={s.checkbox} checked={tos} onChange={(e) => setTos(e.target.checked)} />
                  <label htmlFor="tos" style={s.label}>
                    Принимаю{' '}
                    <a href="/legal/terms" target="_blank" rel="noreferrer" style={s.link}>
                      Пользовательское соглашение
                    </a>
                  </label>
                </li>
              )}
              {needPd && (
                <li style={s.item}>
                  <input id="pd" type="checkbox" style={s.checkbox} checked={pd} onChange={(e) => setPd(e.target.checked)} />
                  <label htmlFor="pd" style={s.label}>
                    Согласен на{' '}
                    <a href="/legal/pd-consent" target="_blank" rel="noreferrer" style={s.link}>
                      обработку персональных данных
                    </a>
                  </label>
                </li>
              )}
              <li style={s.item}>
                <input id="age" type="checkbox" style={s.checkbox} checked={age} onChange={(e) => setAge(e.target.checked)} />
                <label htmlFor="age" style={s.label}>
                  Подтверждаю, что мне исполнилось 18 лет
                </label>
              </li>
              {marketingDocId && (
                <li style={s.item}>
                  <input
                    id="marketing"
                    type="checkbox"
                    style={s.checkbox}
                    checked={marketing}
                    onChange={(e) => setMarketing(e.target.checked)}
                  />
                  <label htmlFor="marketing" style={s.label}>
                    Согласен на получение рекламных сообщений <span style={s.optional}>(необязательно)</span>
                  </label>
                </li>
              )}
            </ul>
            <button
              type="button"
              style={canContinue ? s.btn : { ...s.btn, ...s.btnDisabled }}
              disabled={!canContinue}
              aria-disabled={!canContinue}
              onClick={() => void submit()}
            >
              {saving ? 'Сохраняем…' : 'Продолжить'}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
