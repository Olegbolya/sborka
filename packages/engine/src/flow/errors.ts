/** Error of the participant flow; `message` is shown to the participant as is, so it is in Russian. */
export class FlowError extends Error {
  constructor(
    readonly code:
      | 'FINISHED'
      | 'NOT_ON_SCREEN'
      | 'NOT_A_QUESTION'
      | 'INVALID_ANSWER'
      | 'ANSWER_LOCKED'
      | 'REQUIRED'
      | 'BACK_FORBIDDEN'
      | 'NO_TIMER'
      | 'TIMER_NOT_EXPIRED'
      | 'UNKNOWN_SCREEN',
    message: string,
    readonly details: ReadonlyArray<{ blockId: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'FlowError';
  }
}
