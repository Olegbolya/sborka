'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api-browser';

/**
 * Ссылка входа в шапке и подвале публичных страниц. Страницы отдаются без привязки к человеку, поэтому по умолчанию — «Войти»;
 * если в браузере есть вход, после загрузки ссылка меняется на «Кабинет».
 */
export function AccountLink({ className }: { className?: string }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let alive = true;
    api('/auth/me')
      .then(() => alive && setSignedIn(true))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return (
    <a href={signedIn ? '/cabinet/projects' : '/login'} className={className}>
      {signedIn ? 'Кабинет' : 'Войти'}
    </a>
  );
}
