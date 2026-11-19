-- ADR-120: копирование сборки разрешает автор на тарифах «Автор», «Плюс» и «Про»; на «Старте» и у пропуска «Праздник» — нет.
-- Меняется один ключ в лимитах; остальные лимиты, в том числе поправленные в админке, не трогаются.
UPDATE plans SET limits = limits || '{"allowCopy": true}'::jsonb WHERE code IN ('AUTHOR', 'PLUS', 'PRO');
UPDATE plans SET limits = limits || '{"allowCopy": false}'::jsonb WHERE code IN ('FREE', 'PASS');
