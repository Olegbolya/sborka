import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from '../app/page.js';
import { metadata } from '../app/layout.js';

describe('главная страница', () => {
  it('показывает название «Блокум» и описание на русском', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('Блокум');
    expect(html).toContain('скоро');
    expect(html).toContain('390');
  });

  it('до запуска закрыта от индексации', () => {
    expect(metadata.robots).toMatchObject({ index: false });
  });
});
