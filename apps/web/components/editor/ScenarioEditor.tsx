'use client';
import { type Rule, type Trigger } from '@blokum/schema';
import { useState, useSyncExternalStore } from 'react';
import { describeAction, describeCondition, describeTrigger, namesOf } from '../../lib/editor/rule-text';
import { type RuleOwner, addRule, duplicateRule, moveRule, removeRule, setRuleCondition, setRuleFields, setTrigger } from '../../lib/editor/rules';
import { type MakeContext, TRIGGERS, specOf } from '../../lib/editor/scenario-specs';
import { ConditionEditor, newCondition } from './ConditionEditor';
import { NumberInput, SelectInput, TextInput, Toggle } from './controls';
import { useEditor, useEnv } from './context';
import { ActionList, PartForm } from './ScenarioForm';

/** SC-02 · the rules of one owner (a block, a screen or the assembly) as a constructor «Когда → Если → Сделать». */
export function ScenarioEditor({ owner, rules, title = 'Правила' }: { owner: RuleOwner; rules: readonly Rule[]; title?: string }) {
  const doc = useEditor((s) => s.doc);
  const apply = useEditor((s) => s.apply);
  const screenId = useEditor((s) => s.selection.screenId);
  const { picker } = useEnv();
  const picking = useSyncExternalStore(picker.subscribe, picker.getSnapshot, picker.getSnapshot);
  const [open, setOpen] = useState<string | null>(null);
  const names = namesOf(doc);
  const selfId = owner.kind === 'block' ? owner.blockId : (doc.screens.find((s) => s.id === screenId)?.blocks[0]?.id ?? doc.screens[0]?.blocks[0]?.id ?? '');
  const ctx: MakeContext = { doc, self: selfId, screenId: owner.kind === 'screen' ? owner.screenId : screenId };
  const triggerList = owner.kind === 'block' ? TRIGGERS : TRIGGERS.filter((t) => !['tap', 'doubleTap', 'longPress', 'hover', 'drag', 'mediaEnd', 'scratched'].includes(t.kind));

  const create = (kind: string) => {
    const spec = specOf(TRIGGERS, kind);
    if (!spec) return;
    let made = '';
    apply(
      addRule(owner, spec.make(ctx) as Trigger, { kind: 'wait', ms: 0 }, (id) => (made = id)),
      { label: 'Новое правило' },
    );
    if (made) setOpen(made);
  };

  return (
    <div className="ed-section" data-testid="scenario-editor">
      <h2>{title}</h2>
      {picking.active && (
        <p role="status" className="ed-banner ok" data-testid="picker-hint">
          {picking.prompt}{' '}
          <button type="button" className="ed-btn small" onClick={() => picker.cancel()}>
            Отмена
          </button>
        </p>
      )}
      {rules.map((rule, index) => {
        const isOpen = open === rule.id;
        const triggerSpec = specOf(TRIGGERS, rule.when.kind)!;
        const summary = `Когда ${describeTrigger(rule.when, names)}${rule.if ? `, если ${describeCondition(rule.if, names)}` : ''} → ${describeAction(rule.do[0]!, names)}${rule.do.length > 1 ? ` и ещё ${rule.do.length - 1}` : ''}`;
        return (
          <div key={rule.id} className="ed-layer" data-rule={rule.id} data-enabled={rule.enabled}>
            <div className="ed-layerhead">
              <button type="button" className="ed-link" aria-expanded={isOpen} aria-label={`Правило ${index + 1}${rule.name ? `: ${rule.name}` : ''}`} onClick={() => setOpen(isOpen ? null : rule.id)}>
                {rule.name ? `${rule.name} — ` : ''}
                {summary}
              </button>
              <span className="ed-row">
                <button type="button" className="ed-btn small" aria-label={`Правило ${index + 1}: выше`} disabled={index === 0} onClick={() => apply(moveRule(owner, rule.id, -1), { label: 'Порядок правил' })}>
                  ↑
                </button>
                <button type="button" className="ed-btn small" aria-label={`Правило ${index + 1}: ниже`} disabled={index === rules.length - 1} onClick={() => apply(moveRule(owner, rule.id, 1), { label: 'Порядок правил' })}>
                  ↓
                </button>
                <button type="button" className="ed-btn small" aria-label={`Правило ${index + 1}: копия`} onClick={() => apply(duplicateRule(owner, rule.id), { label: 'Копия правила' })}>
                  Копия
                </button>
                <button type="button" className="ed-btn small" aria-label={`Правило ${index + 1}: удалить`} onClick={() => apply(removeRule(owner, rule.id), { label: 'Удалить правило' })}>
                  ✕
                </button>
              </span>
            </div>
            {isOpen && (
              <div className="ed-layer-fields">
                <Toggle control={`rule:${index}:on`} label="Правило включено" value={rule.enabled} onChange={(enabled) => apply(setRuleFields(owner, rule.id, { enabled }), { label: 'Правило включено' })} />
                <TextInput control={`rule:${index}:name`} label="Название правила" value={rule.name ?? ''} max={80} placeholder="Не обязательно" onChange={(name) => apply(setRuleFields(owner, rule.id, { name }), { label: 'Название правила', mergeKey: `rule-name:${rule.id}` })} />
                <Toggle control={`rule:${index}:once`} label="Сработать только один раз" value={rule.once} onChange={(once) => apply(setRuleFields(owner, rule.id, { once }), { label: 'Один раз' })} />
                <NumberInput control={`rule:${index}:priority`} label="Важность (больше — раньше)" value={rule.priority} min={0} max={100} onChange={(priority) => apply(setRuleFields(owner, rule.id, { priority }), { label: 'Важность правила', mergeKey: `rule-priority:${rule.id}` })} />

                <div className="ed-layer" role="group" aria-label="Когда">
                  <strong>Когда</strong>
                  <SelectInput<string>
                    control={`rule:${index}:when`}
                    label="Когда: что происходит"
                    value={rule.when.kind}
                    options={triggerList.map((t) => [t.kind, t.title] as const)}
                    onChange={(kind) => apply(setTrigger(owner, rule.id, specOf(TRIGGERS, kind)!.make(ctx) as Trigger), { label: 'Когда' })}
                  />
                  <p className="ed-hint">{triggerSpec.hint}</p>
                  <PartForm spec={triggerSpec} value={rule.when} ctx={ctx} place={null} onChange={(v) => apply(setTrigger(owner, rule.id, v as unknown as Trigger), { label: `Когда: ${triggerSpec.title}`, mergeKey: `when:${rule.id}` })} />
                </div>

                <div className="ed-layer" role="group" aria-label="Если">
                  <strong>Если</strong>
                  <Toggle control={`rule:${index}:if`} label="Проверять условие" value={rule.if !== undefined} onChange={(on) => apply(setRuleCondition(owner, rule.id, on ? newCondition('variable', { variableIds: doc.variables.map((v) => v.id), questionIds: [], blockIds: [] }) : null), { label: 'Условие правила' })} />
                  {rule.if && <ConditionEditor label="Если" value={rule.if} onChange={(c) => apply(setRuleCondition(owner, rule.id, c), { label: 'Условие правила', mergeKey: `if:${rule.id}` })} />}
                </div>

                <ActionList label="Сделать" owner={owner} ruleId={rule.id} path={[]} actions={rule.do} />
              </div>
            )}
          </div>
        );
      })}
      <SelectInput<string>
        control="add-rule"
        label="Добавить правило: когда"
        value=""
        options={[['', rules.length >= 50 ? 'Больше 50 правил нельзя' : 'Добавить правило: когда…'], ...triggerList.map((t) => [t.kind, t.title] as const)]}
        onChange={(kind) => kind !== '' && rules.length < 50 && create(kind)}
      />
    </div>
  );
}
