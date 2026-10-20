import { describe, expect, it } from 'vitest';
import { ALLOWED_LICENSES, validateLicenseRecord } from '../src/index.js';

describe('лицензии ассетов', () => {
  it('собственный ассет с автором и источником — без замечаний', () => {
    expect(validateLicenseRecord({ license: 'own', author: 'Блокум', source: 'создано для Блокума' })).toEqual([]);
  });

  it('список совпадает со скриптом check-licenses', () => {
    expect([...ALLOWED_LICENSES]).toEqual(['own', 'OFL-1.1', 'CC0-1.0', 'MIT', 'Apache-2.0', 'CC-BY-4.0']);
  });

  it('неизвестная лицензия, пустой автор и источник — три замечания', () => {
    const problems = validateLicenseRecord({ license: 'скачано из интернета', author: ' ', source: '' });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('не из разрешённого списка');
  });

  it('CC-BY требует указания авторства', () => {
    expect(validateLicenseRecord({ license: 'CC-BY-4.0', author: 'А', source: 'https://example.org' })).toEqual([
      'Для CC-BY-4.0 обязательна строка указания авторства',
    ]);
    expect(
      validateLicenseRecord({ license: 'CC-BY-4.0', author: 'А', source: 'https://example.org', attribution: 'Фото: А' }),
    ).toEqual([]);
  });
});
