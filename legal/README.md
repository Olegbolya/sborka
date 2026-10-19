# Юридические документы

Тексты публичных документов (`terms.md`, `offer.md`, `privacy.md`, `pd-consent.md`, `participant-consent-template.md`, `dpa.md`, `content-rules.md`, `cookies.md`, `marketing.md`, `complaints.md`, `contacts.md`, `participant-notice.md`) пишутся в задаче P8.1 по требованиям `docs/05-LEGAL.md` §3. Внутренние документы оператора ПД — в `internal/` (задача P8.6), не публикуются.

Подстановки:
- `{{ИСПОЛНИТЕЛЬ_*}}` — реквизиты владельца сервиса, заполняются по решению 1 из `docs/00-OWNER-DECISIONS.md`. Пока они не заполнены, документ нельзя публиковать (`node scripts/check-legal.mjs --strict`).
- `{{СОЗДАТЕЛЬ_*}}`, `{{СБОРКА_*}}`, `{{УЧАСТНИК_*}}` — заполняются сервисом автоматически (например, в согласии участника).

Перед публикацией тексты проверяет юрист (`docs/05-LEGAL.md` §9).
