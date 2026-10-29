/**
 * P3.8 · SC-02 · «выбор блока кликом по холсту»: a field of the rule asks the canvas for a block; the next tap on a block
 * of the canvas answers it instead of selecting the block. The state is outside the document (it is nobody's work to keep).
 */
export interface PickerState {
  active: boolean;
  prompt: string;
}

export class BlockPicker {
  private state: PickerState = { active: false, prompt: '' };
  private answer: ((blockId: string) => void) | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): PickerState => this.state;

  get active(): boolean {
    return this.state.active;
  }

  /** A new request replaces the one that was waiting. */
  request(prompt: string, answer: (blockId: string) => void): void {
    this.answer = answer;
    this.set({ active: true, prompt });
  }

  /** The canvas calls it with the tapped block; true when a request took the answer. */
  resolve(blockId: string): boolean {
    const answer = this.answer;
    if (!this.state.active || !answer) return false;
    this.answer = null;
    this.set({ active: false, prompt: '' });
    answer(blockId);
    return true;
  }

  cancel(): void {
    if (!this.state.active) return;
    this.answer = null;
    this.set({ active: false, prompt: '' });
  }

  private set(next: PickerState): void {
    this.state = next;
    for (const fn of this.listeners) fn();
  }
}
