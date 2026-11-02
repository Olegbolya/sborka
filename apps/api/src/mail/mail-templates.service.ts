import { Injectable } from '@nestjs/common';
import { MAIL_TEMPLATES, type MailKind, type MailTemplate } from './mail-templates.js';

export interface RenderedMail {
  readonly kind: MailKind;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly marketing: boolean;
  readonly unsubscribeUrl?: string;
}

export interface RenderInput {
  readonly kind: MailKind;
  readonly variables: Record<string, string | number>;
  /** Marketing letters require this URL — the renderer refuses to compose a marketing letter without it. */
  readonly unsubscribeUrl?: string;
  /** The display address shown in the footer; defaults to «hello@blokker.ru» for all transactional letters. */
  readonly supportEmail?: string;
}

const HTML_ESCAPE_RE = /[&<>"']/g;
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function htmlEscape(value: string): string {
  return value.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPES[ch] ?? ch);
}

const VAR_RE = /\{\{(\w+)\}\}/g;

function render(template: string, variables: Record<string, string | number>, escape: (v: string) => string): string {
  return template.replace(VAR_RE, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`Отсутствует переменная «${name}» для письма «${template.slice(0, 32)}…»`);
    }
    const raw = variables[name];
    return escape(typeof raw === 'number' ? String(raw) : raw ?? '');
  });
}

const UNSUBSCRIBE_TEXT_SUFFIX = (url: string): string =>
  `\n\n---\nЭто рекламное письмо. Отписаться от рассылки: ${url}`;
const UNSUBSCRIBE_HTML_SUFFIX = (url: string): string =>
  `<hr><p style="color:#888;font-size:12px;">Это рекламное письмо. <a href="${htmlEscape(url)}">Отписаться от рассылки</a>.</p>`;

/**
 * P10.6 · renders a letter from the catalogue. Validation (05-LEGAL §2.3, N-05):
 *  - every `{{variable}}` in the template must be provided;
 *  - marketing kinds (`marketing.*`) require `unsubscribeUrl` and the result includes the footer;
 *  - HTML variables are escaped, so a user name like `<script>` becomes safe text.
 */
@Injectable()
export class MailTemplatesService {
  render(input: RenderInput): RenderedMail {
    const template: MailTemplate | undefined = MAIL_TEMPLATES[input.kind];
    if (!template) throw new Error(`Неизвестный шаблон письма: «${input.kind as string}»`);
    for (const name of template.variables) {
      if (!Object.prototype.hasOwnProperty.call(input.variables, name)) {
        throw new Error(`Шаблону «${input.kind}» нужна переменная «${name}»`);
      }
    }
    if (template.marketing && !input.unsubscribeUrl) {
      throw new Error(`Рекламное письмо «${input.kind}» нельзя отправить без ссылки отписки (05-LEGAL §2.3)`);
    }

    const subject = render(template.subject, input.variables, (v) => v);
    let text = render(template.text, input.variables, (v) => v);
    let html = render(template.html, input.variables, htmlEscape);
    if (template.marketing && input.unsubscribeUrl) {
      text += UNSUBSCRIBE_TEXT_SUFFIX(input.unsubscribeUrl);
      html += UNSUBSCRIBE_HTML_SUFFIX(input.unsubscribeUrl);
    }

    const out: RenderedMail = {
      kind: input.kind,
      subject,
      text,
      html,
      marketing: template.marketing,
      ...(template.marketing && input.unsubscribeUrl ? { unsubscribeUrl: input.unsubscribeUrl } : {}),
    };
    return out;
  }

  /** List of all template kinds; useful for the admin screen that previews current wording. */
  catalogue(): ReadonlyArray<{ kind: MailKind; subject: string; marketing: boolean; variables: ReadonlyArray<string> }> {
    return Object.values(MAIL_TEMPLATES).map((t) => ({ kind: t.kind, subject: t.subject, marketing: t.marketing, variables: t.variables }));
  }
}
