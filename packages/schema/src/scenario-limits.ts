import { type TriggerKind } from './scenario.js';

/** Triggers caused by a gesture of the participant: only they may open links or copy text (TS-07). */
export const GESTURE_TRIGGERS: readonly TriggerKind[] = ['tap', 'doubleTap', 'longPress', 'hover', 'drag', 'drop', 'swipe', 'key'];

/** SC-04: runtime limits of the scenario engine. */
export const SCENARIO_LIMITS = { stepsPerSecond: 1000, nestingDepth: 20, maxCopies: 200, conditionDepth: 8 } as const;
