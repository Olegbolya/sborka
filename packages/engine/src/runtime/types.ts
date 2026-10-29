import { type Action, type ANIMATABLE, type MediaOverlay, type MediaRef, type SETTABLE_PROPERTIES, type Transition } from '@blokum/schema';
import { type AnswerValue } from '../flow/answers.js';
import { type VariableValue } from '../flow/conditions.js';

export type Animatable = (typeof ANIMATABLE)[number];
export type SettableProperty = (typeof SETTABLE_PROPERTIES)[number];

/** Input from the player: gestures, media and sensors, answers (TR-01…TR-16). */
export type RuntimeEvent =
  | { type: 'tap' | 'doubleTap'; blockId: string }
  /** Sent once per press: when released or when 3 s have passed; rules with a threshold ≤ `ms` fire. */
  | { type: 'longPress'; blockId: string; ms: number }
  | { type: 'hover'; blockId: string; phase: 'enter' | 'leave' }
  | { type: 'dragStart'; blockId: string }
  /** New position relative to the parent, in artboard units. */
  | { type: 'dragMove'; blockId: string; x: number; y: number }
  | { type: 'dragEnd'; blockId: string; x?: number; y?: number }
  | { type: 'swipe'; direction: 'left' | 'right' | 'up' | 'down'; blockId?: string }
  | { type: 'answer'; questionBlockId: string; answer: AnswerValue | null }
  | { type: 'mediaEnd'; blockId: string }
  | { type: 'scratched'; blockId: string; percent: number }
  | { type: 'deviceMotion'; motion: 'shake' | 'tiltLeft' | 'tiltRight' | 'tiltForward' | 'tiltBack' }
  | { type: 'key'; key: string }
  /** Position of the finger or cursor on the screen (absolute units): fleeing BH-02 and following BH-08. */
  | { type: 'pointer'; x: number; y: number };

/** What the host must do after a step (the runtime itself never touches the DOM, network or storage). */
export type RuntimeEffect =
  | { type: 'navigate'; to: 'next' | 'back' | 'branch' | 'screen'; screenId?: string; transition?: Transition }
  | { type: 'finish'; resultKey?: string }
  | { type: 'effect'; effect: 'confetti' | 'burst' | 'shake' | 'flash' | 'vibrate'; intensity: number; at?: { x: number; y: number } }
  | { type: 'mediaOverlay'; overlay: MediaOverlay }
  | { type: 'media'; blockId: string; command: 'play' | 'pause' | 'stop' | 'restart' }
  | { type: 'playSound'; media: MediaRef }
  | { type: 'record'; label: string; value: VariableValue }
  | { type: 'openLink'; url: string }
  | { type: 'copyText'; text: string }
  | { type: 'answer'; questionBlockId: string; answer: AnswerValue | null }
  /** BH-06: the wheel stopped on a sector (the player records it; the draw itself comes from the server, RN-01). */
  | { type: 'wheel'; blockId: string; sectorBlockId: string }
  | { type: 'warning'; ruleId: string; message: string };

export interface StepResult {
  effects: RuntimeEffect[];
  /** Instances whose view changed (including spawned and destroyed ones). */
  changed: string[];
  spawned: string[];
  destroyed: string[];
  /** Variables changed during the step, with new values. */
  variables: Record<string, VariableValue>;
}

/** What the renderer draws for one block or copy. */
export interface BlockView {
  id: string;
  /** Block of the document this instance shows (for a copy — its prototype). */
  protoId: string;
  copy: boolean;
  parentId: string | null;
  visible: boolean;
  /** Animate the last show/hide (AC-01). */
  animateVisibility: boolean;
  interactive: boolean;
  dragging: boolean;
  zoneId: string | null;
  selected: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
  /** AC-02 overrides by property path, already validated against the style schema. A new object on every change. */
  overrides: Readonly<Partial<Record<SettableProperty, unknown>>>;
  /** Animated numeric values (scale, opacity, filters…) on top of the style. A new object on every change. */
  anim: Readonly<Partial<Record<Animatable, number>>>;
  media: 'playing' | 'paused' | 'stopped' | null;
  /** BH-07: the card shows its back side. */
  flipped: boolean;
}

/** SC-03 · what the debugger of the preview is told: which rule fired and why not, which action ran, where a step stopped. */
export type DebugEvent =
  /** `fired` — the rule started; `condition` — its «Если» was false; `once` — it was marked «один раз» and has run. */
  | { type: 'rule'; ruleId: string; status: 'fired' | 'condition' | 'once'; at: number; self?: string }
  | { type: 'action'; ruleId: string; action: string; detail: Action; at: number; self?: string }
  /** Step mode: the rule waits before this action until the debugger lets one action go. */
  | { type: 'paused'; ruleId: string; next: string; detail: Action; at: number; self?: string };

export interface RuntimeDebug {
  onEvent: (event: DebugEvent) => void;
}
