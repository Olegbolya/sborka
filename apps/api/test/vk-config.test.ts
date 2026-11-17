import { describe, expect, it } from 'vitest';
import { loadApiConfig, vkScreenName } from '../src/config.js';

describe('D-07 · настройки сообщества ВКонтакте (ADR-110)', () => {
  it('D-07 · короткий адрес понимается в любом виде, как его копируют: адрес, @адрес, ссылки vk.com, vk.ru, m.vk.com', () => {
    for (const raw of ['blokker_ru', '@blokker_ru', ' blokker_ru ', 'vk.com/blokker_ru', 'https://vk.com/blokker_ru', 'https://vk.ru/blokker_ru/', 'https://m.vk.com/blokker_ru?from=groups', 'http://www.vk.com/blokker_ru', 'https://vk.me/blokker_ru'])
      expect(vkScreenName(raw), raw).toBe('blokker_ru');
    expect(vkScreenName('https://vk.ru/club230000001')).toBe('club230000001');
    for (const raw of ['', 'сообщество блоккер', 'https://vk.ru/', undefined]) expect(vkScreenName(raw), String(raw)).toBe('');
  });

  it('D-07 · все пять значений есть — сообщество включено; номер в любом виде ВК; любого нет или номер не число — выключено', () => {
    const full = { VK_GROUP_TOKEN: 'ключ', VK_GROUP_ID: '230000001', VK_GROUP_SCREEN_NAME: 'https://vk.ru/blokker_ru', VK_CALLBACK_SECRET: 'секрет', VK_CALLBACK_CONFIRMATION: 'a1b2c3d4' };
    expect(loadApiConfig(full).vk).toEqual({ token: 'ключ', groupId: 230000001, screenName: 'blokker_ru', secret: 'секрет', confirmation: 'a1b2c3d4' });
    for (const id of ['club230000001', 'public230000001', '-230000001']) expect(loadApiConfig({ ...full, VK_GROUP_ID: id }).vk?.groupId, id).toBe(230000001);
    expect(loadApiConfig({ ...full, VK_GROUP_ID: 'блоккер' }).vk).toBeUndefined();
    expect(loadApiConfig({ ...full, VK_CALLBACK_SECRET: '' }).vk).toBeUndefined();
  });
});
