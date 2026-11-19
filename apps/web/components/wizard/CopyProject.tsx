'use client';
import { useEffect, useState } from 'react';
import { api, errorText, isApiError } from '../../lib/api-browser';
import { rememberAfterLogin } from '../../lib/after-login';

/**
 * ADR-120 · «Скопировать себе»: a signed-in person gets a draft copy of the published project and lands in the editor; one who is not
 * signed in goes through the sign-in and comes back here (the address is kept, see `after-login`).
 */
export function CopyProject({ slug }: { slug: string }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const here = `/copy/${slug}`;
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
        const made = await api<{ id: string }>('/projects/copy', { method: 'POST', body: { slug } });
        if (!cancelled) window.location.replace(`/app/projects/${made.id}/edit`);
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '32px 16px', textAlign: 'center' }}>
      {error ? (
        <div role="alert" data-testid="copy-error">
          <p style={{ fontSize: 17, margin: '0 0 16px' }}>{error}</p>
          <a href={`/s/${encodeURIComponent(slug)}`}>Вернуться к сборке</a>
        </div>
      ) : (
        <p role="status" style={{ fontSize: 17 }} data-testid="copy-progress">
          Копируем сборку к вам в кабинет…
        </p>
      )}
    </main>
  );
}
