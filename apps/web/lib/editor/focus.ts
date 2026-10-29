/**
 * P3.8 · SC-07 · «перейти к ошибке»: the check asks the editor to show a place — the tab of the inspector, a rule of a block, the
 * panel of scenarios of a screen or of the assembly. The request lives outside the document, like the picker of a block.
 */
export interface FocusRequest {
  /** Bumps on every request: the same place asked twice is shown twice. */
  seq: number;
  tab?: 'look' | 'content' | 'scenarios';
  ruleId?: string;
  /** The panel of scenarios of the assembly (rules of a screen or of everything). */
  dialog?: { tab: 'doc' | 'screen'; screenId?: string };
}

export class InspectorFocus {
  private state: FocusRequest = { seq: 0 };
  private readonly listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): FocusRequest => this.state;

  request(place: Omit<FocusRequest, 'seq'>): void {
    this.state = { ...place, seq: this.state.seq + 1 };
    for (const fn of this.listeners) fn();
  }
}
