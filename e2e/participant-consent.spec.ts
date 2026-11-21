import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { nextButton, seedProject } from './helpers/editor';

/* B-20 · PL-23 · ADR-131 · у галочки согласия в плеере — ссылка на текст согласия этой сборки с данными оператора. */
const SHOTS = 'e2e/__screenshots__';

test('B-20 · участник открывает текст согласия по ссылке у галочки: оператор, цель, перечень ПД и срок этой сборки', async ({ page, browser }, info) => {
  await loginAndOnboard(page, freshUser('Автор'));
  const origin = new URL(page.url()).origin;
  const { id } = await seedProject(page, (d) => {
    d.screens[0]!.blocks.push(
      { id: 'telefon_1', type: 'textInput', name: 'Телефон', frame: { x: 20, y: 40, w: 340, h: 56 }, props: { semantic: 'phone', placeholder: 'Телефон' } },
      { id: 'soglasie_1', type: 'consent', name: 'Согласие', frame: { x: 20, y: 120, w: 340, h: 48 }, props: { linkText: 'Согласен на обработку персональных данных' } },
      nextButton('dalshe_1', 'Записаться', 220),
    );
  }, 'Пробное занятие');
  const call = (path: string, data?: unknown) => page.request.fetch(`/api/v1/projects/${id}${path}`, { method: data === undefined ? 'POST' : 'PATCH', headers: { origin }, ...(data === undefined ? {} : { data }) });
  expect((await call('/operator-info', { name: 'ИП Петрова Анна Сергеевна', email: 'anna@studio.ru', purpose: 'Запись на пробное занятие', retentionPeriod: '6 месяцев' })).ok()).toBe(true);
  expect((await call('/dpa-accept')).ok()).toBe(true);
  expect((await call('/operator-ack')).ok()).toBe(true);
  const published = await page.request.post(`/api/v1/projects/${id}/publish`, { data: {}, headers: { origin } });
  expect(published.ok(), await published.text()).toBe(true);
  const { slug } = (await (await page.request.get(`/api/v1/projects/${id}`)).json()) as { slug: string };

  const ctx = await browser.newContext({ baseURL: info.project.use.baseURL!, locale: 'ru-RU', viewport: info.project.use.viewport ?? { width: 390, height: 844 } });
  const guest = await ctx.newPage();
  await guest.goto(`/s/${slug}`);
  const link = guest.getByRole('link', { name: 'Согласен на обработку персональных данных' });
  await expect(link).toHaveAttribute('href', `/legal/consent/${id}`);
  await guest.goto(`/legal/consent/${id}`);
  const text = guest.getByTestId('participant-consent');
  await expect(text.getByRole('heading', { level: 1 })).toHaveText('Согласие на обработку персональных данных — «Пробное занятие»');
  for (const piece of ['ИП Петрова Анна Сергеевна', 'anna@studio.ru', 'Запись на пробное занятие', 'номер телефона', '6 месяцев']) await expect(text).toContainText(piece);
  await expect(text).not.toContainText('{{');
  mkdirSync(SHOTS, { recursive: true });
  await guest.screenshot({ path: `${SHOTS}/participant-consent-${info.project.name}.png` });
  await ctx.close();
});
