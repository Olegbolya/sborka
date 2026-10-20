import { z } from './locale.js';
import { Id, MediaRef, int, num } from './primitives.js';
import { Behavior, Condition, Rule } from './scenario.js';
import { BlockAnimation, BlockStates, BlockStyle, Frame } from './style.js';
import { RichText } from './text.js';

// Catalogue of universal blocks (01-PRODUCT-SPEC.md §6). Every block has the same style (S-00),
// may hold rules and behaviors (§7) and child blocks; only `props` differ by type.

const media = MediaRef.nullable().default(null);

/** Option of a choice question (B-11, B-12): its look is a child block, the meta is here. */
export const ChoiceOption = z.strictObject({
  id: Id,
  blockId: Id,
  correct: z.boolean().default(false),
  score: num(-1000, 1000).default(0),
  resultTags: z.array(z.string().min(1).max(40)).max(10).default([]),
});

export const BLOCK_PROPS = {
  text: z.strictObject({}), // B-01 — content is Block.textLayer
  image: z.strictObject({ media, caption: z.string().max(300).optional() }), // B-02
  gif: z.strictObject({ media }), // B-03
  video: z.strictObject({ media, nextOnEnd: z.boolean().default(false), trackCompletion: z.boolean().default(false) }), // B-04
  audio: z.strictObject({ media, role: z.enum(['background', 'effect']).default('effect'), volume: num(0, 1).default(1) }), // B-05
  shape: z.strictObject({}), // B-06 — any S-02 shape
  animation: z.strictObject({ media, frame: int(0, 100000).optional() }), // B-07 — Lottie/WebP/APNG/WebM
  timer: z.strictObject({
    mode: z.enum(['duration', 'until']).default('duration'),
    seconds: int(1, 86400).default(60),
    until: z.iso.datetime().optional(),
    format: z.enum(['mm:ss', 'hh:mm:ss', 'seconds', 'words']).default('mm:ss'),
    autoStart: z.boolean().default(true),
  }), // B-08
  progress: z.strictObject({
    variant: z.enum(['bar', 'dots', 'fraction', 'variable']).default('bar'),
    variableId: Id.optional(),
    max: num(1, 100000).optional(),
  }), // B-09
  container: z.strictObject({}), // B-21
  zone: z.strictObject({ visible: z.boolean().default(false) }), // B-22
  value: z.strictObject({
    variableId: Id,
    format: z.enum(['number', 'text', 'icons', 'time', 'fraction']).default('number'),
    icon: z.string().max(8).optional(),
    max: num(1, 100000).optional(),
  }), // B-23
  singleChoice: z.strictObject({
    required: z.boolean().default(false),
    shuffle: z.boolean().default(false),
    autoAdvance: z.boolean().default(false),
    options: z.array(ChoiceOption).min(2).max(30),
  }), // B-11
  multiChoice: z.strictObject({
    required: z.boolean().default(false),
    shuffle: z.boolean().default(false),
    minSelected: int(0, 30).default(0),
    maxSelected: int(1, 30).optional(),
    options: z.array(ChoiceOption).min(2).max(30),
  }), // B-12
  textInput: z.strictObject({
    multiline: z.boolean().default(false),
    placeholder: z.string().max(200).default(''),
    minLength: int(0, 5000).default(0),
    maxLength: int(1, 5000).default(500),
    mask: z.enum(['none', 'number', 'date']).default('none'),
    required: z.boolean().default(false),
    /** Personal-data meaning of the field (PL-23): makes the creator fill operator details before publishing. */
    semantic: z.enum(['none', 'name', 'phone', 'email', 'city']).default('none'),
  }), // B-13
  scale: z.strictObject({
    variant: z.enum(['stars', 'hearts', 'emoji', 'images', 'numbers', 'slider']).default('stars'),
    min: int(0, 100).default(1),
    max: int(1, 100).default(5),
    step: num(0.1, 100).default(1),
    labels: z.strictObject({ min: z.string().max(60).optional(), max: z.string().max(60).optional() }).prefault({}),
    icons: z.array(MediaRef).max(10).default([]),
    required: z.boolean().default(false),
  }), // B-14
  swipe: z.strictObject({
    leftLabel: z.string().max(40).default('Нет'),
    rightLabel: z.string().max(40).default('Да'),
    buttons: z.boolean().default(true),
    required: z.boolean().default(false),
  }), // B-15
  ranking: z.strictObject({
    items: z.array(z.strictObject({ id: Id, label: z.string().min(1).max(200) })).min(2).max(15),
    required: z.boolean().default(false),
  }), // B-16
  date: z.strictObject({
    mode: z.enum(['date', 'time', 'datetime']).default('date'),
    min: z.string().max(40).optional(),
    max: z.string().max(40).optional(),
    required: z.boolean().default(false),
  }), // B-17
  button: z.strictObject({ requiresAnswers: z.boolean().default(false) }), // B-18 — actions are its rules
  contacts: z.strictObject({
    fields: z.array(z.enum(['name', 'phone', 'email', 'city'])).min(1).max(4),
    required: z.boolean().default(true),
  }), // B-19
  consent: z.strictObject({ linkText: z.string().min(1).max(200).default('Согласен на обработку персональных данных') }), // B-20
} as const;

export type BlockType = keyof typeof BLOCK_PROPS;
export const BLOCK_TYPES = Object.keys(BLOCK_PROPS) as BlockType[];

/** Specification ids of block types (01-PRODUCT-SPEC.md §6). */
export const BLOCK_TYPE_IDS: Record<BlockType, string> = {
  text: 'B-01',
  image: 'B-02',
  gif: 'B-03',
  video: 'B-04',
  audio: 'B-05',
  shape: 'B-06',
  animation: 'B-07',
  timer: 'B-08',
  progress: 'B-09',
  singleChoice: 'B-11',
  multiChoice: 'B-12',
  textInput: 'B-13',
  scale: 'B-14',
  swipe: 'B-15',
  ranking: 'B-16',
  date: 'B-17',
  button: 'B-18',
  contacts: 'B-19',
  consent: 'B-20',
  container: 'B-21',
  zone: 'B-22',
  value: 'B-23',
};

/** Blocks whose answer is stored in a participant session. */
export const QUESTION_TYPES: readonly BlockType[] = ['singleChoice', 'multiChoice', 'textInput', 'scale', 'swipe', 'ranking', 'date', 'contacts', 'consent'];

/** Fields shared by every block, whatever its type (S-00, S-01, S-12…S-17). */
const commonFields = {
  id: Id,
  name: z.string().min(1).max(60),
  frame: Frame,
  z: int(0, 100000).default(0),
  locked: z.boolean().default(false),
  hiddenInEditor: z.boolean().default(false),
  groupId: Id.optional(),
  style: BlockStyle.prefault({}),
  textLayer: RichText.optional(),
  animation: BlockAnimation.optional(),
  states: BlockStates.optional(),
  visibleIf: Condition.optional(),
  initiallyHidden: z.boolean().default(false),
  behaviors: z.array(Behavior).max(8).default([]),
  rules: z.array(Rule).max(50).default([]),
  a11y: z.strictObject({ alt: z.string().max(300).optional(), label: z.string().max(200).optional() }).prefault({}),
};

type Common = z.infer<z.ZodObject<typeof commonFields>>;
type CommonInput = z.input<z.ZodObject<typeof commonFields>>;
type PropsOf<T extends BlockType> = z.infer<(typeof BLOCK_PROPS)[T]>;
type PropsInputOf<T extends BlockType> = z.input<(typeof BLOCK_PROPS)[T]>;

export type BlockOf<T extends BlockType> = Common & { type: T; props: PropsOf<T>; children: Block[] };
export type Block = { [T in BlockType]: BlockOf<T> }[BlockType];
export type BlockInputOf<T extends BlockType> = CommonInput & { type: T; props: PropsInputOf<T>; children?: BlockInput[] };
export type BlockInput = { [T in BlockType]: BlockInputOf<T> }[BlockType];

const member = <T extends BlockType>(type: T) =>
  z.strictObject({
    ...commonFields,
    type: z.literal(type),
    props: BLOCK_PROPS[type],
    children: z.array(z.lazy(() => Block)).max(100).default([]),
  });

/** A block of any type with its child blocks (recursive). */
export const Block: z.ZodType<Block, BlockInput> = z.lazy(
  () =>
    z.discriminatedUnion(
      'type',
      BLOCK_TYPES.map((t) => member(t)) as unknown as [ReturnType<typeof member>, ...ReturnType<typeof member>[]],
    ) as unknown as z.ZodType<Block, BlockInput>,
);

/** All blocks of a tree, depth-first, children after their parent. */
export function* walkBlocks(blocks: readonly Block[]): Generator<Block> {
  for (const b of blocks) {
    yield b;
    yield* walkBlocks(b.children);
  }
}
