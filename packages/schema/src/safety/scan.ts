import { type Block } from '../blocks.js';
import { type ProjectDocument } from '../document.js';
import { plainText } from '../plain-text.js';
import { RichText } from '../text.js';
import { collectRules, walkActions } from '../validate.js';
import { walkBlocks } from '../walk.js';
import { BRAND_COMPILED } from './brand-terms.js';
import { foldDomain, linkProblem, type LinkProblem } from './links.js';
import { compileTerms, findTerms, type CompiledTerm } from './match.js';
import { PHISHING_COMPILED } from './phishing-terms.js';

/** TS-04 · a stop word of category A or B with its weight (1–100), as kept in the admin. */
export interface StopTerm {
  id: string;
  text: string;
  category: 'A' | 'B';
  weight: number;
}

export interface SafetyDictionary {
  stopTerms: readonly StopTerm[];
  /** TS-05 · domains the administrators have put on the stop-list. */
  blockedDomains: readonly string[];
}

/** From this weight a stop word stops the publication until a person looks (TS-04). */
export const STOP_WORD_BLOCK_WEIGHT = 80;

export type SafetyCode = 'PHISHING_FIELD' | 'PHISHING_LINK' | 'BRAND' | 'STOP_WORD' | 'STOP_WORD_BLOCK' | 'LINK_SHORTENER' | 'LINK_IP' | 'LINK_BLOCKED' | 'LINK_INVALID'
  // P9.2 · TS-06: what a new account, or an account without a confirmed phone, may not do.
  | 'NEW_ACCOUNT_LINK' | 'PHONE_LINK' | 'NEW_ACCOUNT_LIMIT' | 'NEW_ACCOUNT_VIDEO';

export interface SafetyIssue {
  code: SafetyCode;
  /** `error` stops the publication; `review` means a person looks at it (the publication of a young account waits, an older one gets a warning). */
  severity: 'error' | 'review';
  path: Array<string | number>;
  message: string;
  /** The dictionary entry that matched, for the case in the queue. */
  term?: string;
  /** The report category of docs/06-TRUST-SAFETY.md §2 the finding belongs to. */
  category?: string;
}

export interface TextSite {
  path: Array<string | number>;
  text: string;
}

export interface LinkSite {
  path: Array<string | number>;
  url: string;
}

export interface ScreenFacts {
  screenId: string;
  screenName: string;
  texts: TextSite[];
  links: LinkSite[];
  hasInput: boolean;
}

const asRichText = (value: unknown): { text: string; hrefs: string[] } | undefined => {
  if (typeof value === 'string') return { text: value, hrefs: [] };
  const r = RichText.safeParse(value);
  if (!r.success) return undefined;
  return { text: plainText(r.data), hrefs: hrefsOf(r.data) };
};

function hrefsOf(rt: { paragraphs: Array<{ runs: Array<object> }> }): string[] {
  const out: string[] = [];
  for (const p of rt.paragraphs) for (const run of p.runs) if ('href' in run && typeof run.href === 'string') out.push(run.href);
  return out;
}

function blockTexts(b: Block, path: Array<string | number>): { texts: TextSite[]; links: LinkSite[] } {
  const texts: TextSite[] = [];
  const links: LinkSite[] = [];
  const add = (key: string, text: string | undefined) => {
    if (text && text.trim() !== '') texts.push({ path: [...path, key], text });
  };
  if (b.textLayer) {
    add('textLayer', plainText(b.textLayer));
    for (const h of hrefsOf(b.textLayer)) links.push({ path: [...path, 'textLayer'], url: h });
  }
  add('a11y.alt', b.a11y.alt);
  add('a11y.label', b.a11y.label);
  switch (b.type) {
    case 'image':
      add('props.caption', b.props.caption);
      break;
    case 'textInput':
      add('props.placeholder', b.props.placeholder);
      break;
    case 'scale':
      add('props.labels.min', b.props.labels.min);
      add('props.labels.max', b.props.labels.max);
      break;
    case 'swipe':
      add('props.leftLabel', b.props.leftLabel);
      add('props.rightLabel', b.props.rightLabel);
      break;
    case 'ranking':
      b.props.items.forEach((it, i) => add(`props.items.${i}`, it.label));
      break;
    case 'consent':
      add('props.linkText', b.props.linkText);
      break;
    default:
      break;
  }
  return { texts, links };
}

/** Everything a participant can read or follow on each screen, with where it is (for the message to the creator). */
export function screenFacts(doc: ProjectDocument): ScreenFacts[] {
  const rulesByScreen = new Map<string, ReturnType<typeof collectRules>>();
  for (const site of collectRules(doc)) {
    if (!site.screen) continue;
    const list = rulesByScreen.get(site.screen.id) ?? [];
    list.push(site);
    rulesByScreen.set(site.screen.id, list);
  }
  const documentRules = doc.rules;
  return doc.screens.map((screen, si) => {
    const base = ['screens', si];
    const texts: TextSite[] = [{ path: [...base, 'name'], text: screen.name }];
    const links: LinkSite[] = [];
    let hasInput = false;
    for (const b of walkBlocks(screen.blocks)) {
      if (b.type === 'textInput' || b.type === 'contacts') hasInput = true;
      const found = blockTexts(b, [...base, 'block', b.id]);
      texts.push(...found.texts);
      links.push(...found.links);
    }
    // Texts that rules put on the page (AC-02) and links they open (AC-16) are read by participants too.
    const sites = [...(rulesByScreen.get(screen.id) ?? []), ...documentRules.map((rule, i) => ({ rule, path: ['rules', i] as Array<string | number> }))];
    for (const { rule, path } of sites) {
      for (const [a, p] of walkActions(rule.do, [...path, 'do'])) {
        if (a.kind === 'setProperty' && a.property === 'textLayer') {
          const v = asRichText(a.value);
          if (v) {
            texts.push({ path: p, text: v.text });
            for (const h of v.hrefs) links.push({ path: p, url: h });
          }
        } else if (a.kind === 'openLink') {
          links.push({ path: p, url: a.url });
        } else if (a.kind === 'copyText') {
          texts.push({ path: p, text: a.text });
        }
      }
    }
    return { screenId: screen.id, screenName: screen.name, texts, links, hasInput };
  });
}

const LINK_MESSAGES: Record<LinkProblem, { code: SafetyCode; message: string }> = {
  SHORTENER: { code: 'LINK_SHORTENER', message: 'Ссылка ведёт через сервис сокращения ссылок — настоящий адрес скрыт. Вставьте полный адрес сайта.' },
  IP_ADDRESS: { code: 'LINK_IP', message: 'Ссылка ведёт на адрес из цифр вместо названия сайта. Так можно прятать настоящий сайт — вставьте ссылку с названием сайта.' },
  BLOCKED_DOMAIN: { code: 'LINK_BLOCKED', message: 'Этот сайт у нас в списке запрещённых. Ссылку на него размещать нельзя.' },
  NOT_A_WEB_LINK: { code: 'LINK_INVALID', message: 'Ссылка записана неверно. Она должна начинаться с https:// или http://.' },
};

const stopCompiled = (terms: readonly StopTerm[]): Array<{ compiled: CompiledTerm; term: StopTerm }> =>
  terms.flatMap((term) => compileTerms([{ id: term.id, text: term.text, exact: term.text.replace(/[^\p{L}\p{N}]/gu, '').length <= 3 }]).map((compiled) => ({ compiled, term })));

/**
 * P9.1 · SR-01, TS-02…TS-05 · what the dictionaries find in a document: the texts of every screen, the title and the description,
 * the texts that rules put on the page, and every link. `extraTitle` is the name of the project, which is kept next to the document.
 */
export function scanDocument(doc: ProjectDocument, dict: SafetyDictionary, extraTitle?: string): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
  const stops = stopCompiled(dict.stopTerms);
  const seen = new Set<string>();
  const once = (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const check = (site: TextSite, screen: ScreenFacts | undefined) => {
    // TS-04 · stop words: the heaviest stop the publication, the others go to a person.
    for (const hit of findTerms(site.text, stops.map((s) => s.compiled))) {
      const term = stops.find((s) => s.compiled.spec.id === hit.id)!.term;
      const heavy = term.weight >= STOP_WORD_BLOCK_WEIGHT;
      if (!once(`stop:${term.id}`)) continue;
      issues.push({
        code: heavy ? 'STOP_WORD_BLOCK' : 'STOP_WORD',
        severity: heavy ? 'error' : 'review',
        path: site.path,
        term: term.text,
        category: term.category,
        message: heavy
          ? `В тексте есть слова, которые запрещены правилами сервиса («${term.text}»). Уберите их — тогда сборку можно будет опубликовать.`
          : `В тексте есть слово «${term.text}», которое модератор посмотрит перед тем, как сборка станет доступна всем.`,
      });
    }
    // TS-03 · brands and state bodies.
    for (const hit of findTerms(site.text, BRAND_COMPILED)) {
      if (!once(`brand:${hit.id}`)) continue;
      issues.push({
        code: 'BRAND',
        severity: 'review',
        path: site.path,
        term: hit.text,
        category: 'B7',
        message: `В тексте названа организация («${hit.text}»). Сборки, где упоминают банки, госорганы и известные сервисы, смотрит модератор — чтобы никого не выдавали за другого.`,
      });
    }
    // TS-02 · fields that ask for what must not be asked.
    if (screen?.hasInput) {
      for (const hit of findTerms(site.text, PHISHING_COMPILED)) {
        if (!once(`phish:${screen.screenId}:${hit.id}`)) continue;
        issues.push({
          code: 'PHISHING_FIELD',
          severity: 'error',
          path: site.path,
          term: hit.text,
          category: 'A2',
          message: `На экране «${screen.screenName}» есть поле ввода, а рядом — просьба про «${hit.text}». Просить пароли, коды из СМС, данные карт и подобное запрещено: так делают мошенники, и участники этого не ждут. Уберите это из подписи, подсказки и текста рядом.`,
        });
      }
    }
  };

  check({ path: ['meta', 'title'], text: doc.meta.title }, undefined);
  if (doc.meta.description) check({ path: ['meta', 'description'], text: doc.meta.description }, undefined);
  if (extraTitle) check({ path: ['project', 'title'], text: extraTitle }, undefined);

  for (const screen of screenFacts(doc)) {
    for (const site of screen.texts) check(site, screen);
    // A screen without a field that asks for what must not be asked but sends people away: a person looks at it.
    if (!screen.hasInput && screen.links.length > 0) {
      for (const site of screen.texts) {
        for (const hit of findTerms(site.text, PHISHING_COMPILED)) {
          if (!once(`phishlink:${screen.screenId}:${hit.id}`)) continue;
          issues.push({
            code: 'PHISHING_LINK',
            severity: 'review',
            path: site.path,
            term: hit.text,
            category: 'A2',
            message: `На экране «${screen.screenName}» речь о «${hit.text}», и тут же есть ссылка на другой сайт. Такие экраны смотрит модератор.`,
          });
        }
      }
    }
    // TS-05 · links.
    for (const link of screen.links) {
      const problem = linkProblem(link.url, dict.blockedDomains.map(foldDomain));
      if (!problem) continue;
      const m = LINK_MESSAGES[problem];
      if (!once(`link:${link.url}`)) continue;
      issues.push({ code: m.code, severity: 'error', path: link.path, term: link.url, category: problem === 'BLOCKED_DOMAIN' ? 'A6' : 'A3', message: `${m.message} (${link.url})` });
    }
  }
  return issues;
}

/** The web links of the document, for the check against Safe Browsing (TS-05); each address once. */
export function externalLinks(doc: ProjectDocument): string[] {
  const urls = new Set<string>();
  for (const screen of screenFacts(doc)) for (const l of screen.links) if (/^https?:/iu.test(l.url.trim())) urls.add(l.url.trim());
  return [...urls];
}

/** The ids of the uploaded files (not the library) that the document uses, wherever they are. */
export function usedMediaIds(doc: unknown): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.source === 'media' && typeof o.id === 'string') ids.add(o.id);
      for (const x of Object.values(o)) walk(x);
    }
  };
  walk(doc);
  return [...ids];
}
