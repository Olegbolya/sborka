'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { api } from '../../lib/api-browser';
import { ROLE_LABEL } from '../../lib/admin/format';
import { css } from './ui';

interface Me {
  role: 'USER' | 'MODERATOR' | 'ADMIN';
  displayName: string;
}

const LINKS: Array<{ href: string; label: string; admin?: boolean }> = [
  { href: '/admin', label: 'Главная' },
  { href: '/admin/queue', label: 'Очередь жалоб' },
  { href: '/admin/appeals', label: 'Обжалования' },
  { href: '/admin/users', label: 'Пользователи' },
  { href: '/admin/legal', label: 'Заявления и требования' },
  { href: '/admin/content', label: 'Шаблоны и темы', admin: true },
  { href: '/admin/flags', label: 'Выключатели', admin: true },
  { href: '/admin/system', label: 'Состояние', admin: true },
  { href: '/admin/audit', label: 'Журнал аудита', admin: true },
];

/** AD-01 · the frame of the admin: only moderators and administrators get in (the API checks it on every request as well). */
export function AdminShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api<Me>('/auth/account')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return <main style={css.page}><p style={css.muted}>Загрузка…</p></main>;
  if (me === null) {
    return (
      <main style={css.page}>
        <h1 style={css.h1}>Нужен вход</h1>
        <p>Админка открыта только после входа. <Link href="/login" style={{ color: 'var(--accent)' }}>Войти</Link></p>
      </main>
    );
  }
  if (me.role === 'USER') {
    return (
      <main style={css.page}>
        <h1 style={css.h1}>Нет доступа</h1>
        <p>Эта часть сайта — для модераторов и администраторов.</p>
        <Link href="/cabinet/projects" style={{ color: 'var(--accent)' }}>← В мои сборки</Link>
      </main>
    );
  }
  return (
    <div>
      <header style={{ borderBottom: '1px solid var(--border, #ddd)', padding: '10px 16px' }}>
        <nav aria-label="Разделы админки" style={{ ...css.row, maxWidth: 1100, margin: '0 auto', fontSize: 14 }}>
          <strong>Админка</strong>
          {LINKS.filter((l) => !l.admin || me.role === 'ADMIN').map((l) => (
            <Link key={l.href} href={l.href} style={{ color: path === l.href ? 'var(--accent)' : 'inherit', fontWeight: path === l.href ? 700 : 400, textDecoration: 'none' }}>
              {l.label}
            </Link>
          ))}
          <span style={{ marginLeft: 'auto', ...css.muted }}>{me.displayName} · {ROLE_LABEL[me.role]}</span>
        </nav>
      </header>
      <MeContext.Provider value={me}>{children}</MeContext.Provider>
    </div>
  );
}

const MeContext = createContext<Me>({ role: 'MODERATOR', displayName: '' });
/** Who is signed in to the admin (the pages hide what the role cannot do). */
export const useMe = (): Me => useContext(MeContext);
