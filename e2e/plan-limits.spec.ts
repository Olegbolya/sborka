import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshUser, loginAndOnboard } from './helpers/auth';
import { hit, openEditor, openTab, screensList, seedProject, textBlock } from './helpers/editor';
import { subscribeOwner } from './helpers/plan';

const SHOTS = 'e2e/__screenshots__';

test.describe('P7.1 · границы тарифа в редакторе', () => {
  test('04-TARIFFS §2 · «Старт»: 10 экранов и 25 правил — кнопки закрыты, видно «N из M» и как снять ограничение; на «Авторе» открываются', async ({ page }, info) => {
    await loginAndOnboard(page, freshUser('Автор'));
    const { id } = await seedProject(page, (d) => {
      for (let i = 2; i <= 10; i++) d.screens.push({ id: `ekran_${i}_x`, name: `Экран ${i}`, blocks: [] });
      const rules = Array.from({ length: 25 }, (_, i) => ({ id: `pravilo_${i}_x`, when: { kind: 'tap', source: { kind: 'block', blockId: 'knopka_lim' } }, do: [{ kind: 'wait', ms: 0 }] }));
      d.screens[0]!.blocks.push({ ...textBlock('knopka_lim', 'Кнопка', 20, 40, 200, 56), type: 'button', rules });
    });
    await openEditor(page, id);
    await expect(screensList(page)).toHaveCount(10);
    const note = page.getByTestId('screens-limit');
    await expect(note).toContainText('Экранов: 10 из 10 на тарифе «Старт»');
    for (const name of ['Добавить экран', 'Дублировать', 'Вставить экран']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/plan-limits-screens-${info.project.name}.png` });
    await note.getByRole('button', { name: 'Снять ограничение' }).click();
    await expect(page.getByRole('dialog')).toContainText('экранов — не больше 10');
    await page.getByTestId('pass-close').click();

    await hit(page, 'Кнопка').click();
    await openTab(page, 'Сценарии');
    await expect(page.getByTestId('rules-limit')).toContainText('Правил в сборке: 25 из 25 на тарифе «Старт»');
    const add = page.getByLabel('Добавить правило: когда');
    await add.selectOption({ index: 1 });
    await expect(page.locator('[data-rule]')).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'Правило 1: копия' })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/plan-limits-rules-${info.project.name}.png` });

    await subscribeOwner(id, 'AUTHOR');
    await page.reload();
    await expect(page.getByTestId('editor')).toBeVisible();
    await expect(page.getByTestId('screens-limit')).toContainText('Экранов: 10 из 30 на тарифе «Автор»');
    await expect(page.getByRole('button', { name: 'Добавить экран', exact: true })).toBeEnabled();
  });
});
