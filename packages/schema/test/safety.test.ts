import { describe, expect, it } from 'vitest';
import {
  compileTerms,
  createBlock,
  createDocument,
  createRule,
  createScreen,
  externalLinks,
  findTerms,
  foldChars,
  linkProblem,
  scanDocument,
  textForms,
  type Block,
  type ProjectDocument,
  type SafetyDictionary,
} from '../src/index.js';

const rich = (text: string, href?: string) => ({ paragraphs: [{ kind: 'p' as const, runs: [{ t: text, ...(href ? { href } : {}) }] }] });
const withText = (type: 'text' | 'textInput' | 'button' | 'contacts', text: string, extra: Partial<Block> = {}): Block => createBlock(type, { textLayer: rich(text), ...extra });
const docOf = (...screens: Array<{ name?: string; blocks: Block[] }>): ProjectDocument => {
  const doc = createDocument({ title: 'Тест' });
  doc.screens = screens.map((s, i) => ({ ...createScreen(s.name ?? `Экран ${i + 1}`), blocks: s.blocks }));
  return doc;
};
const dict: SafetyDictionary = {
  stopTerms: [
    { id: 's1', text: 'мефедрон', category: 'B', weight: 100 },
    { id: 's2', text: 'казино', category: 'B', weight: 40 },
    { id: 's3', text: 'гарантирован доход', category: 'A', weight: 90 },
  ],
  blockedDomains: ['evil.example'],
};
const hit = (text: string, words: string[]) => findTerms(text, compileTerms(words.map((w, i) => ({ id: String(i), text: w })))).length > 0;

describe('TS-02…TS-04 · нормализация и словари', () => {
  it('TS-02 · нормализация: регистр, «ё»/«е», латиница вместо кириллицы, невидимые знаки', () => {
    expect(foldChars('ПАРОЛЬ')).toBe('пароль');
    expect(foldChars('Пaроль')).toBe(foldChars('пароль')); // латинская «a»
    expect(foldChars('пар​оль')).toBe('пароль'); // невидимый пробел нулевой ширины
    expect(foldChars('Всё')).toBe(foldChars('все'));
    expect(foldChars('п@роль')).toBe('пароль');
  });

  it('TS-02 · слова с пробелами и знаками между буквами читаются как слово', () => {
    expect(textForms('П А Р О Л Ь').glued).toEqual(['пароль']);
    expect(textForms('п.а.р.о.л.ь').glued).toEqual(['пароль']);
    expect(textForms('пар*оль').squeezed).toEqual(['пароль']);
    expect(textForms('и в').glued).toEqual(['и', 'в']); // обычная речь не склеивается
    for (const spoof of ['П А Р О Л Ь', 'п.а.р.о.л.ь', 'пар*оль', 'Пaроль', 'ПАРОЛЬ', 'пa-роль', 'п а р о л ь']) expect(hit(spoof, ['парол']), spoof).toBe(true);
  });

  it('TS-02 · склонения: основа слова находит все падежи, фраза — по словам подряд', () => {
    for (const form of ['пароль', 'пароля', 'паролю', 'паролем', 'паролях']) expect(hit(form, ['парол']), form).toBe(true);
    expect(hit('Введите код из СМС', ['код из смс'])).toBe(true);
    expect(hit('введите кода из смс-сообщения', ['код из смс'])).toBe(true);
    expect(hit('срок действия вашей карты', ['срок действия карт'])).toBe(false); // между словами лишнее слово
    expect(hit('срок действия карты', ['срок действия карт'])).toBe(true);
    expect(hit('номер вашей карты', ['номер карт'])).toBe(false);
  });

  it('TS-02 · короткие слова — только целиком, а не внутри других слов', () => {
    const pin = compileTerms([{ id: 'pin', text: 'пин', exact: true }]);
    expect(findTerms('Введите ПИН', pin)).toHaveLength(1);
    expect(findTerms('Введите пина', pin)).toHaveLength(1);
    expect(findTerms('Пингвин, пинг-понг и пинцет', pin)).toHaveLength(0);
  });
});

describe('TS-02 · детектор фишинговых полей в документе', () => {
  it('TS-02 · подпись или подсказка поля с «пароль», «код из СМС», «CVV» и т.п. — блокирующая ошибка, с учётом подмены букв', () => {
    for (const label of ['Введите пароль', 'Ваш пaроль от банка', 'Код из СМС', 'Код подтверждения', 'CVV', 'Номер карты', 'Срок действия карты', 'Секретная фраза', 'П А Р О Л Ь', 'Данные Госуслуг', 'Серия и номер паспорта']) {
      const doc = docOf({ blocks: [withText('text', label), createBlock('textInput')] });
      const issues = scanDocument(doc, dict);
      expect(issues.some((i) => i.code === 'PHISHING_FIELD' && i.severity === 'error'), label).toBe(true);
    }
  });

  it('TS-02 · подсказка внутри поля (placeholder) проверяется так же', () => {
    const input = createBlock('textInput', { props: { placeholder: 'Введите ваш пароль' } });
    const issues = scanDocument(docOf({ blocks: [input] }), dict);
    expect(issues.map((i) => i.code)).toContain('PHISHING_FIELD');
  });

  it('TS-02 · на экране без поля ввода слово «пароль» ничего не ломает (урок о безопасности паролей)', () => {
    const doc = docOf({ blocks: [withText('text', 'Как придумать надёжный пароль: 5 правил')] });
    expect(scanDocument(doc, dict)).toEqual([]);
  });

  it('TS-02 · … но если на экране есть ссылка на другой сайт, такой экран смотрит модератор', () => {
    const doc = docOf({ blocks: [withText('text', 'Войдите, введя пароль', {}), withText('text', 'Перейти', { textLayer: rich('Перейти', 'https://example.org/login') })] });
    const issues = scanDocument(doc, dict);
    expect(issues.find((i) => i.code === 'PHISHING_LINK')?.severity).toBe('review');
  });

  it('TS-02 · блок «Контакты» тоже считается полем: рядом «CVV» — ошибка', () => {
    const doc = docOf({ blocks: [withText('text', 'Подтвердите CVV'), createBlock('contacts', { props: { fields: ['name'] } } as never)] });
    expect(scanDocument(doc, dict).map((i) => i.code)).toContain('PHISHING_FIELD');
  });

  it('TS-02 · текст, который правило подставляет на экран (AC-02), проверяется как обычный', () => {
    const target = withText('text', 'Привет');
    const input = createBlock('textInput');
    const button = createBlock('button');
    button.rules = [
      createRule({ kind: 'tap', source: { kind: 'block', blockId: button.id } } as never, [
        { kind: 'setProperty', target: { kind: 'block', blockId: target.id }, property: 'textLayer', value: rich('Введите код из СМС'), durationMs: 0 } as never,
      ]),
    ];
    const issues = scanDocument(docOf({ blocks: [target, input, button] }), dict);
    expect(issues.map((i) => i.code)).toContain('PHISHING_FIELD');
  });
});

describe('TS-03 · стоп-лист брендов и госорганов', () => {
  it('TS-03 · банк, Госуслуги, маркетплейс, оператор в названии или тексте — на проверку; без совпадений ничего нет', () => {
    for (const t of ['Сбербанк: акция', 'Вход через Госуслуги', 'Скидки Wildberries', 'Тариф МТС', 'Тинькофф бонус', 'СБЕР']) {
      const issues = scanDocument(docOf({ blocks: [withText('text', t)] }), dict);
      expect(issues.find((i) => i.code === 'BRAND')?.severity, t).toBe('review');
    }
    expect(scanDocument(docOf({ blocks: [withText('text', 'Праздничная открытка для мамы')] }), dict)).toEqual([]);
    // слово «сберегать» — не бренд
    expect(scanDocument(docOf({ blocks: [withText('text', 'как сберегать деньги')] }), dict)).toEqual([]);
  });

  it('TS-03 · название сборки (не только текст на экране) проверяется', () => {
    const issues = scanDocument(docOf({ blocks: [] }), dict, 'Сбербанк розыгрыш');
    expect(issues.find((i) => i.code === 'BRAND')?.path).toEqual(['project', 'title']);
  });
});

describe('TS-04 · стоп-слова категорий A/B с весами', () => {
  it('TS-04 · высший вес блокирует публикацию, остальные — на проверку модератору; склонения и подмена букв находятся', () => {
    const heavy = scanDocument(docOf({ blocks: [withText('text', 'Купить МЕФЕДРОН дёшево')] }), dict);
    expect(heavy.find((i) => i.code === 'STOP_WORD_BLOCK')).toMatchObject({ severity: 'error', category: 'B' });
    const light = scanDocument(docOf({ blocks: [withText('text', 'Лучшие казино 2027')] }), dict);
    expect(light.find((i) => i.code === 'STOP_WORD')).toMatchObject({ severity: 'review' });
    expect(scanDocument(docOf({ blocks: [withText('text', 'мeфедрoн')] }), dict).map((i) => i.code)).toContain('STOP_WORD_BLOCK');
    expect(scanDocument(docOf({ blocks: [withText('text', 'гарантированного дохода')] }), dict).map((i) => i.code)).toContain('STOP_WORD_BLOCK');
    expect(scanDocument(docOf({ blocks: [withText('text', 'м е ф е д р о н')] }), dict).map((i) => i.code)).toContain('STOP_WORD_BLOCK');
  });

  it('TS-04 · одно слово — одно замечание, сколько бы раз оно ни встречалось', () => {
    const doc = docOf({ blocks: [withText('text', 'казино казино'), withText('text', 'казино')] }, { blocks: [withText('text', 'казино')] });
    expect(scanDocument(doc, dict).filter((i) => i.code === 'STOP_WORD')).toHaveLength(1);
  });

  it('TS-04 · пустой словарь — документ проходит (продукт работает без наполнения)', () => {
    expect(scanDocument(docOf({ blocks: [withText('text', 'Купить мефедрон')] }), { stopTerms: [], blockedDomains: [] })).toEqual([]);
  });
});

describe('TS-05 · внешние ссылки', () => {
  it('TS-05 · сокращатели, IP-адреса и запрещённые домены отклоняются; обычные сайты, почта и телефон проходят', () => {
    expect(linkProblem('https://bit.ly/abc')).toBe('SHORTENER');
    expect(linkProblem('https://m.vk.cc/abc')).toBe('SHORTENER');
    expect(linkProblem('http://185.12.4.5/login')).toBe('IP_ADDRESS');
    expect(linkProblem('http://2130706433/')).toBe('IP_ADDRESS'); // число вместо адреса
    expect(linkProblem('http://[::1]/')).toBe('IP_ADDRESS');
    expect(linkProblem('https://www.evil.example/x', ['evil.example'])).toBe('BLOCKED_DOMAIN');
    expect(linkProblem('https://a.b.evil.example/', ['https://www.Evil.example/'])).toBe('BLOCKED_DOMAIN');
    expect(linkProblem('https://notevil.example/', ['evil.example'])).toBeUndefined();
    expect(linkProblem('https://example.org/page?x=1')).toBeUndefined();
    expect(linkProblem('mailto:a@b.ru')).toBeUndefined();
    expect(linkProblem('tel:+79001234567')).toBeUndefined();
    expect(linkProblem('not a url')).toBe('NOT_A_WEB_LINK');
  });

  it('TS-05 · ссылка в тексте и в действии «открыть ссылку» проверяется при публикации', () => {
    const textLink = withText('text', 'Нажмите', { textLayer: rich('Нажмите', 'https://bit.ly/zzz') });
    expect(scanDocument(docOf({ blocks: [textLink] }), dict).find((i) => i.code === 'LINK_SHORTENER')).toMatchObject({ severity: 'error' });
    const button = createBlock('button');
    button.rules = [createRule({ kind: 'tap', source: { kind: 'block', blockId: button.id } } as never, [{ kind: 'openLink', url: 'http://10.0.0.1/' } as never])];
    expect(scanDocument(docOf({ blocks: [button] }), dict).find((i) => i.code === 'LINK_IP')).toMatchObject({ severity: 'error' });
    const evil = withText('text', 'x', { textLayer: rich('x', 'https://evil.example/a') });
    expect(scanDocument(docOf({ blocks: [evil] }), dict).map((i) => i.code)).toContain('LINK_BLOCKED');
  });

  it('TS-05 · список веб-ссылок для проверки в Яндекс Safe Browsing: без почты и телефона, каждая один раз', () => {
    const a = withText('text', 'a', { textLayer: rich('a', 'https://example.org/1') });
    const b = withText('text', 'b', { textLayer: rich('b', 'https://example.org/1') });
    const c = withText('text', 'c', { textLayer: rich('c', 'mailto:x@y.ru') });
    expect(externalLinks(docOf({ blocks: [a, b, c] }))).toEqual(['https://example.org/1']);
  });
});
