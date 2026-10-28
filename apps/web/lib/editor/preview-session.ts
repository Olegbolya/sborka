import { type ProjectDocument, parseSettableValue } from '@blokum/schema';
import { PassageSession, type PassageView } from '../play/passage-session';

export type PreviewView = PassageView;

/**
 * The preview of the editor is a passage that sends nothing anywhere (E-20): the same session as the player's. Unlike the
 * player, it checks the values of «change property» actions itself — the document has not been through publishing yet.
 */
export class PreviewSession extends PassageSession {
  constructor(doc: ProjectDocument, options: ConstructorParameters<typeof PassageSession>[1] = {}) {
    super(doc, { parseValue: parseSettableValue, ...options });
  }
}
