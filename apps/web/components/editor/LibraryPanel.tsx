'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../../lib/api-browser';
import { type LibraryItem, libraryUrl } from '../../lib/editor/media';
import { useAddBlocks } from './AddPanel';
import { useEnv } from './context';

interface Collection {
  id: string;
  kind: string;
  title: string;
  itemCount: number;
}

const LICENSE_TITLE: Record<string, string> = { OWN: 'Своё', OFL: 'OFL', CC0: 'CC0', MIT: 'MIT', APACHE: 'Apache 2.0', CC_BY: 'CC BY', LICENSED: 'По лицензии' };

/**
 * LB-02, LB-03 · вкладка «Библиотека»: файлы платформы — коллекции, поиск, теги. Вставка не копирует файл: в блоке лежит ссылка.
 * Пока библиотека пуста, вкладка так и говорит и ведёт к своей медиатеке; продукт без библиотеки работает полностью.
 */
export function LibraryPanel() {
  const { media } = useEnv();
  const { addMedia } = useAddBlocks();
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [current, setCurrent] = useState<string>('');
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Collection[]>('/library/collections')
      .then((list) => {
        setCollections(list);
        setCurrent((was) => was || list[0]?.id || '');
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    if (!current) {
      setItems(null);
      return;
    }
    const timer = setTimeout(() => {
      const q = search.trim();
      api<LibraryItem[]>(`/library/collections/${encodeURIComponent(current)}/items${q ? `?search=${encodeURIComponent(q)}` : ''}`)
        .then((list) => {
          setItems(list.filter((i) => i.fontId === null));
          setError(null);
        })
        .catch((e: unknown) => setError(errorText(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [current, search]);

  const tags = useMemo(() => [...new Set((items ?? []).flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b, 'ru')), [items]);
  const shown = (items ?? []).filter((i) => !tag || i.tags.includes(tag));
  const collection = collections?.find((c) => c.id === current);

  const insert = (item: LibraryItem): void => {
    media.addLibrary([item]);
    addMedia({ source: 'library', id: item.id });
  };

  if (error && !collections) return <div className="ed-section" data-testid="library-panel"><p role="alert" className="ed-hint">{error}</p></div>;
  if (collections && collections.length === 0) {
    return (
      <div className="ed-section" data-testid="library-panel">
        <p className="ed-hint">Библиотека пополняется</p>
        <div className="ed-actions">
          <a href="/cabinet/media" className="ed-btn small">
            Загрузить своё
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="ed-section" data-testid="library-panel">
      {!collections ? (
        <p className="ed-hint">Загрузка…</p>
      ) : (
        <>
          <select className="ed-title" aria-label="Коллекция библиотеки" value={current} onChange={(e) => { setCurrent(e.target.value); setTag(''); setItems(null); }}>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.itemCount})
              </option>
            ))}
          </select>
          <input type="search" className="ed-title" aria-label="Найти в библиотеке" placeholder="Найти по названию или тегу" value={search} onChange={(e) => setSearch(e.target.value)} />
          {tags.length > 0 && (
            <div className="ed-actions" role="group" aria-label="Теги">
              {tags.map((t) => (
                <button key={t} type="button" className={`ed-chip${tag === t ? ' is-on' : ''}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? '' : t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {error && <p role="alert" className="ed-hint">{error}</p>}
          {collection && collection.kind === 'FONTS' && <p className="ed-hint">Шрифты из библиотеки выбираются в свойствах текста, а не вставляются блоком.</p>}
          {items && shown.length === 0 && <p className="ed-hint">{search || tag ? 'Ничего не нашлось. Попробуйте другое слово или тег.' : 'В этой коллекции пока пусто.'}</p>}
          <ul className="ed-list ed-libgrid" aria-label="Файлы библиотеки">
            {shown.map((it) => (
              <li key={it.id}>
                <button type="button" className="ed-libitem" data-testid={`library-insert-${it.id}`} onClick={() => insert(it)} title={`Вставить «${it.title}»`}>
                  {it.kind === 'AUDIO' ? <span className="ed-libthumb ed-libsound" aria-hidden="true">♪</span> : it.kind === 'VIDEO' ? <video className="ed-libthumb" src={libraryUrl(it.id)} muted preload="metadata" aria-hidden="true" /> : <img className="ed-libthumb" src={libraryUrl(it.id)} alt="" loading="lazy" />}
                  <span className="name">
                    {it.title}
                    <br />
                    <small>
                      {LICENSE_TITLE[it.license] ?? it.license} · {it.author}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="ed-actions">
            <a href="/cabinet/media" className="ed-btn small">
              Загрузить своё
            </a>
          </div>
        </>
      )}
    </div>
  );
}
