import { describe, expect, it } from 'vitest';
import { MAIL_KINDS, MAIL_TEMPLATES } from '../src/mail/mail-templates.js';
import { MailTemplatesService } from '../src/mail/mail-templates.service.js';

/**
 * P10.6 · шаблоны всех писем (уведомления, платежи, модерация, напоминания, рекламные с отпиской).
 */
describe('P10.6 · шаблоны писем', () => {
  const service = new MailTemplatesService();

  it('N-05 · у каждого шаблона есть subject, text, html — только по-русски', () => {
    expect(MAIL_KINDS.length).toBeGreaterThanOrEqual(14);
    const cyr = /[А-Яа-яЁё]/;
    for (const kind of MAIL_KINDS) {
      const t = MAIL_TEMPLATES[kind];
      expect(t.subject.length).toBeGreaterThan(0);
      expect(t.text.length).toBeGreaterThan(0);
      expect(t.html.length).toBeGreaterThan(0);
      expect(t.subject, kind).toMatch(cyr);
      expect(t.text, kind).toMatch(cyr);
    }
  });

  it('P10.6 · каталог помечает маркетинг отдельно и перечисляет переменные', () => {
    const catalogue = service.catalogue();
    expect(catalogue.length).toBe(MAIL_KINDS.length);
    const marketing = catalogue.filter((c) => c.marketing);
    expect(marketing.length).toBeGreaterThanOrEqual(2);
    for (const c of marketing) expect(c.kind.startsWith('marketing.')).toBe(true);
    for (const c of catalogue) expect(c.variables).toContain('displayName');
  });

  it('P10.6 · рендер подставляет переменные во всех частях письма', () => {
    const r = service.render({
      kind: 'account.email-verify',
      variables: { displayName: 'Иван', verifyUrl: 'https://blokker.ru/verify?t=abc' },
    });
    expect(r.subject).toContain('Блоккера');
    expect(r.text).toContain('Иван');
    expect(r.text).toContain('https://blokker.ru/verify?t=abc');
    expect(r.html).toContain('Иван');
    expect(r.html).toContain('https://blokker.ru/verify?t=abc');
    expect(r.marketing).toBe(false);
    expect(r.unsubscribeUrl).toBeUndefined();
  });

  it('P10.6 · HTML-переменные экранируются (XSS невозможен через имя пользователя)', () => {
    const r = service.render({
      kind: 'account.email-verify',
      variables: { displayName: '<script>alert(1)</script>', verifyUrl: 'https://blokker.ru/v?a=1&b=2' },
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    // В тексте экранирования нет — там не рендерится HTML.
    expect(r.text).toContain('<script>');
    // Амперсанд в URL в HTML должен быть экранирован.
    expect(r.html).toContain('a=1&amp;b=2');
  });

  it('05-LEGAL §2.3 · рекламное письмо требует ссылку отписки, которая появляется в тексте и HTML', () => {
    const r = service.render({
      kind: 'marketing.tips',
      variables: {
        displayName: 'Мария',
        exampleTitle: 'Приглашение с ответом',
        tipBody: 'Собрать приглашение можно из шаблона «Приглашение с ответом» за 10 минут.',
        exampleUrl: 'https://blokker.ru/app/new?template=sys-tpl-rsvp-invite',
      },
      unsubscribeUrl: 'https://blokker.ru/mail/unsubscribe?token=xyz',
    });
    expect(r.marketing).toBe(true);
    expect(r.unsubscribeUrl).toBe('https://blokker.ru/mail/unsubscribe?token=xyz');
    expect(r.text).toContain('Отписаться от рассылки');
    expect(r.text).toContain('https://blokker.ru/mail/unsubscribe?token=xyz');
    expect(r.html).toContain('Отписаться от рассылки');
    expect(r.html).toContain('https://blokker.ru/mail/unsubscribe?token=xyz');
  });

  it('05-LEGAL §2.3 · маркетинговое письмо нельзя отправить без ссылки отписки', () => {
    expect(() =>
      service.render({
        kind: 'marketing.feature-announcement',
        variables: { displayName: 'А', featureTitle: 'Темы', featureSummary: 'Теперь можно собрать свою тему из картинки.', featureUrl: 'https://blokker.ru/help/themes' },
      }),
    ).toThrow(/отписки/);
  });

  it('P10.6 · отсутствие нужной переменной — явная ошибка, а не «{{displayName}}» в тексте', () => {
    expect(() =>
      service.render({ kind: 'account.email-verify', variables: { verifyUrl: 'https://blokker.ru/v?t=1' } }),
    ).toThrow(/displayName/);
  });

  it('P10.6 · неизвестный тип письма — явная ошибка', () => {
    expect(() => service.render({ kind: 'account.unknown' as never, variables: {} })).toThrow(/Неизвестн/);
  });

  it.each(MAIL_KINDS)('P10.6 · шаблон «%s» рендерится при заполненных переменных', (kind) => {
    const template = MAIL_TEMPLATES[kind];
    const variables: Record<string, string | number> = {};
    for (const name of template.variables) variables[name] = `val-${name}`;
    const r = service.render(template.marketing ? { kind, variables, unsubscribeUrl: 'https://blokker.ru/u?t=1' } : { kind, variables });
    expect(r.subject).not.toContain('{{');
    expect(r.text).not.toContain('{{');
    expect(r.html).not.toContain('{{');
  });
});
