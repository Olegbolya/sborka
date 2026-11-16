'use client';
import { useEffect, useState } from 'react';
import { api, errorText, isApiError } from '../../lib/api-browser';
import { rememberAfterLogin } from '../../lib/after-login';

/**
 * TPL-05.2 · «Собрать такую же»: a signed-in person gets a draft from the template and lands in the editor; one who is not signed in
 * goes through the sign-in and comes back here (the address is kept, see `after-login`), so the template is not asked for twice.
 */
export function BuildFromTemplate({ slug, source }: { slug: string; source: string }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const here = `/t/${slug}/build${source ? `?src=${source}` : ''}`;
      try {
        await api('/auth/me');
      } catch (e) {
        if (isApiError(e) && e.status === 401) {
          rememberAfterLogin(here);
          window.location.replace('/login');
          return;
        }
        if (!cancelled) setError(errorText(e));
        return;
      }
      try {
        const template = await api<{ id: string }>(`/templates/by-slug/${encodeURIComponent(slug)}`);
        const made = await api<{ id: string }>('/projects', { method: 'POST', body: { templateId: template.id, ...(source ? { source } : {}) } });
        if (!cancelled) window.location.replace(`/app/projects/${made.id}/edit`);
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, source]);
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '32px 16px', textAlign: 'center' }}>
      {error ? (
        <div role="alert" data-testid="build-error">
          <p style={{ fontSize: 17, margin: '0 0 16px' }}>{error}</p>
          <a href={`/t/${encodeURIComponent(slug)}`}>Вернуться к шаблону</a>
        </div>
      ) : (
        <p role="status" style={{ fontSize: 17 }} data-testid="build-progress">
          Собираем такую же сборку…
        </p>
      )}
    </main>
  );
}
