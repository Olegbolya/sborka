import { z } from './locale.js';
import { type Block, Block as BlockSchema } from './blocks.js';
import { walkBlocks } from './walk.js';
import { SCHEMA_VERSION } from './ids.js';
import { Id, MediaRef, int, num } from './primitives.js';
import { Condition, Rule, Variable } from './scenario.js';
import { Fill } from './style.js';
import { ThemeTokens } from './theme.js';
import { MediaByAnswer, ParticlesConfig, Transition } from './transitions.js';

/** Document limits (docs/02-ARCHITECTURE.md §4 п. 2). */
export const DOCUMENT_LIMITS = {
  screens: 50,
  blocksPerScreen: 100,
  rulesPerDocument: 1000,
  variables: 200,
  bytes: 3 * 1024 * 1024,
} as const;

export const BranchTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('next') }),
  z.strictObject({ kind: z.literal('screen'), screenId: Id }),
  z.strictObject({ kind: z.literal('finish') }),
]);
export type BranchTarget = z.infer<typeof BranchTarget>;

/** L-02: «если … → экран Y»; the first matching branch wins, otherwise the next screen. */
export const BranchRule = z.strictObject({ id: Id, if: Condition, to: BranchTarget, transition: Transition.optional() });
export type BranchRule = z.infer<typeof BranchRule>;

export const Screen = z.strictObject({
  id: Id,
  name: z.string().min(1).max(80),
  kind: z.enum(['content', 'question', 'result']).default('content'),
  height: int(400, 5000).default(844),
  background: z.array(Fill).max(4).default([]),
  particles: ParticlesConfig.optional(),
  blocks: z.array(BlockSchema).max(DOCUMENT_LIMITS.blocksPerScreen),
  transitionIn: Transition.prefault({ kind: 'fade', durationMs: 400 }),
  mediaByAnswer: MediaByAnswer.optional(),
  branches: z.array(BranchRule).max(50).default([]),
  rules: z.array(Rule).max(200).default([]),
  timer: z.strictObject({ seconds: int(1, 3600), onExpire: BranchTarget }).optional(),
});
export type Screen = z.infer<typeof Screen>;

/** L-04: how the final result is chosen; the server evaluates it (PL-15). */
export const ResultRule = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('scoreRange'), id: Id, key: z.string().min(1).max(60), screenId: Id, min: num(-100000, 100000), max: num(-100000, 100000) }),
  z.strictObject({ kind: z.literal('tag'), id: Id, key: z.string().min(1).max(60), screenId: Id, tag: z.string().min(1).max(40) }),
  z.strictObject({ kind: z.literal('variable'), id: Id, key: z.string().min(1).max(60), screenId: Id, if: Condition }),
]);

export const Settings = z.strictObject({
  allowBack: z.boolean().default(true),
  showProgress: z.boolean().default(false),
  feedbackMode: z.enum(['instant', 'end', 'none']).default('end'),
  soundEnabledByDefault: z.boolean().default(true),
  /** «Аудитория — дети» forbids fields with personal data (05-LEGAL.md §2.4). */
  audience: z.enum(['general', 'children']).default('general'),
  /** Tie between personality results (L-04). */
  tieBreak: z.enum(['first', 'random']).default('first'),
});

export const ProjectDocument = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    meta: z
      .strictObject({ title: z.string().min(1).max(120), description: z.string().max(500).default(''), ogImage: MediaRef.optional() })
      .prefault({ title: 'Новая сборка' }),
    artboard: z.strictObject({ width: z.literal(390) }).default({ width: 390 }),
    theme: z.strictObject({ themeId: Id.optional(), tokens: ThemeTokens.prefault({}) }).prefault({}),
    settings: Settings.prefault({}),
    variables: z.array(Variable).max(DOCUMENT_LIMITS.variables).default([]),
    rules: z.array(Rule).max(DOCUMENT_LIMITS.rulesPerDocument).default([]),
    screens: z.array(Screen).min(1).max(DOCUMENT_LIMITS.screens),
    results: z.array(ResultRule).max(100).default([]),
  })
  .superRefine((doc, ctx) => {
    doc.screens.forEach((s, i) => {
      const count = [...walkBlocks(s.blocks)].length;
      if (count > DOCUMENT_LIMITS.blocksPerScreen) {
        ctx.addIssue({
          code: 'custom',
          path: ['screens', i, 'blocks'],
          message: `На экране «${s.name}» ${count} блоков — можно не больше ${DOCUMENT_LIMITS.blocksPerScreen}`,
        });
      }
    });
    const rules = countRules(doc);
    if (rules > DOCUMENT_LIMITS.rulesPerDocument) {
      ctx.addIssue({ code: 'custom', path: ['rules'], message: `В сборке ${rules} правил — можно не больше ${DOCUMENT_LIMITS.rulesPerDocument}` });
    }
    const ids = new Set<string>();
    const dup = (id: string, path: (string | number)[]) => {
      if (ids.has(id)) ctx.addIssue({ code: 'custom', path, message: `Идентификатор «${id}» повторяется` });
      ids.add(id);
    };
    doc.screens.forEach((s, i) => {
      dup(s.id, ['screens', i, 'id']);
      for (const b of walkBlocks(s.blocks)) dup(b.id, ['screens', i, 'blocks']);
    });
  });
export type ProjectDocument = z.infer<typeof ProjectDocument>;
export type ProjectDocumentInput = z.input<typeof ProjectDocument>;

/** All rules of a document: document-level, screen-level and block-level. */
export function countRules(doc: { rules: unknown[]; screens: Array<{ rules: unknown[]; blocks: Block[] }> }): number {
  let n = doc.rules.length;
  for (const s of doc.screens) {
    n += s.rules.length;
    for (const b of walkBlocks(s.blocks)) n += b.rules.length;
  }
  return n;
}

/** Throws if the serialised document exceeds the size limit (checked by the API before saving). */
export function assertDocumentSize(json: string): void {
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > DOCUMENT_LIMITS.bytes) {
    throw new RangeError(`Сборка слишком большая: ${(bytes / 1048576).toFixed(1)} МБ, можно не больше 3 МБ`);
  }
}
