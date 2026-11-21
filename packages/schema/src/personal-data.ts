import type { Block } from './blocks.js';
import { walkBlocks } from './walk.js';

/** PL-23 · a kind of personal data a block of the project asks the participant for. */
export type PdField = 'name' | 'phone' | 'email' | 'city';

export const PD_FIELD_TEXT: Record<PdField, string> = { name: 'имя', phone: 'номер телефона', email: 'адрес электронной почты', city: 'город' };

/** The personal data a block collects: the fields of «Контакты» (B-19) and a text field marked «имя / телефон / почта / город» (B-13). */
export function pdFieldsOfBlock(block: Block): PdField[] {
  if (block.type === 'contacts') return [...block.props.fields];
  if (block.type === 'textInput' && block.props.semantic !== 'none') return [block.props.semantic];
  return [];
}

/** PL-23 · everything the project asks for, once each, in a fixed order; empty — the project collects no personal data. */
/** Any document-like value with screens of blocks (the published document, a draft, a test fixture). */
export interface WithScreens {
  screens: ReadonlyArray<{ id: string; name: string; blocks: Block[] }>;
}

export function pdFieldsOf(doc: WithScreens): PdField[] {
  const found = new Set<PdField>();
  for (const screen of doc.screens) for (const block of walkBlocks(screen.blocks)) for (const f of pdFieldsOfBlock(block)) found.add(f);
  return (['name', 'phone', 'email', 'city'] as const).filter((f) => found.has(f));
}

/**
 * 05-LEGAL §2.4 · the screens where personal data is asked for without the consent checkbox (B-20) next to it: the player asks for
 * consent only on the screen where the data is left, so a screen without the checkbox would take the data without consent.
 */
export function screensWithoutConsent(doc: WithScreens): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  for (const screen of doc.screens) {
    const blocks = [...walkBlocks(screen.blocks)];
    if (blocks.some((b) => pdFieldsOfBlock(b).length > 0) && !blocks.some((b) => b.type === 'consent')) out.push({ id: screen.id, name: screen.name });
  }
  return out;
}
