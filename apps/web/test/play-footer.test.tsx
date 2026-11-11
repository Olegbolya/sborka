import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayFooter } from '../components/play/PlayFooter.js';

describe('PL-16 · подвал плеера по тарифам', () => {
  it('PL-16: на тарифе «Старт» полный подвал — возраст, «Создано пользователем», «Пожаловаться» и водяной знак', () => {
    const html = renderToStaticMarkup(<PlayFooter slug="demo" watermark ageRating={0} />);
    expect(html).toContain('0+');
    expect(html).toContain('Создано пользователем');
    expect(html).toContain('Пожаловаться');
    expect(html).toContain('Сделано в Блоккере — создать свою');
  });

  it('PL-16: на платном тарифе остаётся только необходимое — возраст и «Пожаловаться», без подписи и водяного знака', () => {
    const html = renderToStaticMarkup(<PlayFooter slug="demo" watermark={false} ageRating={12} />);
    expect(html).toContain('12+');
    expect(html).toContain('Пожаловаться');
    expect(html).not.toContain('Создано пользователем');
    expect(html).not.toContain('Сделано в Блоккере');
  });

  it('PL-16: «Пожаловаться» не убирается ни на одном тарифе, даже без возрастной отметки', () => {
    for (const watermark of [true, false]) expect(renderToStaticMarkup(<PlayFooter slug="demo" watermark={watermark} />)).toContain('Пожаловаться');
  });
});
