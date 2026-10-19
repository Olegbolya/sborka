# 02 · Архитектура «Сборки»

> Как устроена система и где она работает. Отступать от решений этого документа можно только с записью в `docs/DECISIONS.md` (дата, что меняем, почему, последствия).

---

## 1. Стек

| Слой | Технология | Почему |
|---|---|---|
| Монорепозиторий | pnpm workspaces + Turborepo, TypeScript `strict` везде | Тот же подход, что в BST, — проверен на этом сервере |
| Веб (лендинг, кабинет, редактор, плеер, админка) | **Next.js** (последняя стабильная, App Router), React 19 | SSR первого экрана плеера, OG-метаданные, одно приложение для всех страниц |
| API | **NestJS** (последняя стабильная) | Модули, guards, валидация — агенту проще держать порядок в большом API |
| Фоновые задачи | Node + **BullMQ** (Redis) — отдельный процесс `worker` | Медиа, модерация, экспорт, письма, очистка по срокам хранения, сводки аналитики |
| БД | **PostgreSQL** (уже стоит на сервере) + **Prisma** (последняя стабильная) | Миграции, типизация |
| Кэш, очереди, счётчики | **Redis** (уже стоит на сервере), отдельный номер БД и префикс ключей | |
| Схема документа | **zod** в `packages/schema` | Одна схема для редактора, плеера, API и тестов |
| Состояние редактора | Zustand + Immer + история отмен (zundo или своя) | |
| Холст | DOM-рендер (не canvas) + `react-moveable` / `react-selecto` (MIT) для маркеров и рамки | Плеер и редактор рисуют блоки **одним** компонентом |
| Анимации | Motion (MIT), Lottie (`@lottiefiles/dotlottie-web` или `lottie-web`), `canvas-confetti` (ISC), свои частицы на canvas | |
| Форматированный текст | TipTap (MIT) с ограниченным набором отметок | |
| QR | `qr-code-styling` (MIT) в браузере + `qrcode` на сервере; декодер `jsqr` для проверки читаемости | |
| Медиа | `sharp` (изображения), системный `ffmpeg` (GIF→MP4/WebM, видео), `file-type` (проверка по сигнатуре), ClamAV (антивирус) | |
| Модерация изображений | Открытая NSFW-модель в ONNX (`onnxruntime-node`), запускается в worker | Без отправки картинок за рубеж |
| Графики | Recharts или ECharts | |
| Экспорт | `exceljs` (XLSX), свой CSV с BOM | |
| Тесты | Vitest (юнит), fast-check (свойства/фаззинг схемы), Supertest + реальный PostgreSQL (интеграция API; локально — пакет `embedded-postgres`, в CI — сервис postgres), Playwright (e2e и скриншоты), Lighthouse CI (производительность плеера), k6 (нагрузка) | |

**Внешние сервисы — только российские** (иначе трансграничная передача ПД, `05-LEGAL.md` §2.3):

| Задача | Сервис (выбор — за владельцем, см. `00-OWNER-DECISIONS.md`) | Интерфейс в коде |
|---|---|---|
| Вход | VK ID, Яндекс ID (OAuth 2.1 + PKCE) | `AuthProvider` |
| СМС / звонок с кодом | SMSC.ru, SMS.ru или МТС Exolve | `OtpSender` |
| Письма | Unisender Go, Mailganer или SMTP Яндекс 360 | `Mailer` |
| Капча | Yandex SmartCaptcha | `CaptchaVerifier` |
| Проверка ссылок | Yandex Safe Browsing API | `UrlReputation` |
| Оплата | ЮKassa (основной), Robokassa (запасной) | `PaymentProvider` |
| Резервные копии | Selectel / Yandex Object Storage (S3, регион РФ) | `BackupTarget` |
| Аналитика маркетинговых страниц | Яндекс Метрика — **только** на лендинге и только после согласия на cookie | — |

Для каждого интерфейса есть реализация `Dev*` для разработки и тестов (например, `DevOtpSender` пишет код в лог и **запрещена** при `NODE_ENV=production` — проверка при старте). Шрифты, иконки, библиотеки — только из своих пакетов, **никаких** Google Fonts / внешних CDN в продакшене.

> **Не переносить** из BST: Resend, Cloudflare Worker, Stripe, Google/GitHub OAuth, Sentry SaaS, Pexels/Unsplash — это иностранные сервисы.

---

## 2. Структура репозитория

```
sborka/
├── CLAUDE.md                  # правила для ИИ-агента (читать первым)
├── README.md
├── docs/                      # спецификация, план, прогресс, решения
├── legal/                     # тексты юридических документов (черновики → версии)
│   └── internal/              # внутренние документы оператора ПД (не публикуются)
├── apps/
│   ├── web/                   # Next.js: лендинг, кабинет, редактор, плеер, админка
│   ├── api/                   # NestJS: REST API /api/v1
│   └── worker/                # BullMQ: фоновые задачи
├── packages/
│   ├── schema/                # zod-схемы документа сборки, блоков, стилей, логики + миграции версий документа
│   ├── renderer/              # React-компоненты рендера экрана и блоков (ОДИН источник вида для редактора и плеера)
│   ├── engine/                # движок прохождения: логика переходов, баллы, результаты (чистые функции, без React)
│   ├── themes/                # темы, шаблоны, стикеры, шрифты + манифест лицензий
│   ├── db/                    # Prisma schema, миграции, клиент, seed
│   ├── ui/                    # UI-кит кабинета и редактора
│   └── config/                # общие tsconfig, eslint, vitest
├── e2e/                       # Playwright: сквозные сценарии и скриншоты
├── infra/
│   ├── nginx/                 # конфиги сайта (только свои server_name)
│   ├── pm2/ecosystem.config.cjs
│   ├── server-setup.sh        # однократная подготовка сервера (запускает владелец с sudo)
│   └── backup/                # скрипты резервного копирования и проверки восстановления
├── scripts/                   # verify, проверки запрещённых шаблонов, прогресса, лицензий
└── .github/workflows/         # ci.yml, deploy.yml, server-diagnostics.yml, backup-check.yml
```

**Главное правило рендера:** вид блока описан только в `packages/renderer`. Редактор оборачивает те же компоненты маркерами выделения; плеер — обработчиками прохождения. Дублировать вёрстку блоков в `apps/web` запрещено (урок BST).

**Главное правило логики:** переходы, условия, баллы и результаты считаются только функциями `packages/engine`. Сервер использует их для проверки ответов и подсчёта результата, клиент — для навигации. Ключ правильных ответов в клиентскую сборку не попадает (см. §4.4).

---

## 3. Размещение на сервере (рядом с BST)

Сервер: домашний, Ubuntu 24.04, `95.105.7.135`, пользователь `deploy`. На нём уже работает BST (`~/bst`, PM2 `bst-api` :3000, `bst-renderer` :3002, nginx-сайт `mybst.ru`, PostgreSQL, Redis, Node 20 через nvm).

| Что | Значение для «Сборки» |
|---|---|
| Каталог кода | `/home/deploy/sborka` |
| Данные (медиа, экспорт, временные) | `/home/deploy/sborka-data/{media,exports,tmp,quarantine}` |
| Логи | `/home/deploy/logs/sborka-*.log` |
| Node | **Node 22 LTS** через nvm (`nvm install 22`); путь к интерпретатору явно в `ecosystem.config.cjs`. Node 20 у BST не трогаем |
| PM2 процессы | `sborka-api` (порт **3100**), `sborka-web` (порт **3110**), `sborka-worker` (без порта) |
| PostgreSQL | база `sborka_db`, пользователь `sborka` (отдельный от BST), подключение через `127.0.0.1` |
| Redis | номер БД **3**, префикс ключей `sb:`, префикс очередей BullMQ `sb` |
| nginx | отдельный файл `/etc/nginx/sites-available/sborka.conf` только со своими `server_name`; перед перезагрузкой всегда `nginx -t` |
| Домены | `{ДОМЕН}` — сайт, кабинет, плеер, `/api/*` → api; `{МЕДИА-ДОМЕН}` — пользовательские файлы (**отдельный регистрируемый домен**, чтобы cookie основного сайта туда не уходили; на время разработки допустим поддомен `media.{ДОМЕН}`) |
| Секреты | `/home/deploy/sborka/.env.prod` (права 600), в git — только `.env.prod.example` |

**Запрещено на сервере:** `pm2 restart all`, `pm2 delete all`, `pm2 kill`, правка файлов BST, `nginx`-конфигов BST, базы `bst_db`, Redis БД BST, перезапуск PostgreSQL/Redis без согласования с владельцем.

### 3.1 Режим «до запуска»
Пока владелец не закрыл чек-лист запуска (`00-OWNER-DECISIONS.md` §3), весь сайт закрыт **базовой HTTP-авторизацией nginx** (логин/пароль у владельца) и переменной `PRELAUNCH=1` (регистрация только по приглашениям, баннер «Тестовый режим»). Снимает режим только владелец.

### 3.2 Однократная подготовка сервера
`infra/server-setup.sh` (идемпотентный, запускается владельцем через SSH один раз: `sudo bash infra/server-setup.sh`): создаёт каталоги, пользователя и базу PostgreSQL, ставит `ffmpeg`, `clamav` + `clamav-daemon`, Node 22 для `deploy`, sudoers-правило **только** для `nginx -t`, `systemctl reload nginx` и копирования `sborka.conf`, получает сертификаты certbot для доменов. Скрипт печатает, что сделал, и ничего не меняет у BST.

### 3.3 Деплой
- `ci.yml` — на каждый push и PR: установка, `pnpm verify`, e2e (Playwright) с postgres и redis в сервисах, Lighthouse CI для плеера, gitleaks.
- `deploy.yml` — на push в `main` **после** зелёного CI (`workflow_run`): SSH на сервер (секрет `DEPLOY_SSH_KEY`, тот же ключ, что у BST), `git fetch` по токену запуска, `infra/deploy.sh`: установка зависимостей, сборка, `prisma migrate deploy`, перезапуск процессов **по одному** с проверкой `/api/health` и `/healthz`, откат на предыдущую сборку при провале.
- `server-diagnostics.yml` — ручной запуск: статус PM2 (только `sborka-*`), последние строки логов, место на диске, состояние очередей. Секреты не печатаются.
- Агент в облачной сессии **не имеет** прямого доступа к серверу: всё, что нужно на сервере, делается через эти workflow или через владельца.

---

## 4. Модель документа сборки (`packages/schema`)

Документ сборки — JSON, проверяемый zod-схемой. Пример типов (точные схемы — в коде, этот раздел — контракт):

```ts
type ProjectDocument = {
  schemaVersion: 1;                       // миграции версий: packages/schema/src/migrations
  meta: { title: string; description?: string; ogImage?: MediaRef };
  artboard: { width: 390 };               // E-01
  theme: { themeId: string; overrides?: Partial<ThemeTokens> };
  settings: {
    allowBack: boolean; showProgress: boolean;
    feedbackMode: 'instant' | 'end' | 'none';   // L-03
    soundEnabledByDefault: boolean;
  };
  screens: Screen[];                       // порядок по умолчанию
  results: ResultRule[];                   // L-04
  variables: Variable[];                   // L-05
};

type Screen = {
  id: Id; name: string;
  kind: 'cover' | 'content' | 'question' | 'result';
  height: number;                          // 400..5000
  background: Fill; particles?: ParticlesConfig;      // P-xx
  blocks: Block[];
  transitionIn: TransitionRef;             // T-xx
  rules: BranchRule[];                     // L-02; пустой список = следующий экран
  timer?: { seconds: number; onExpire: BranchTarget };  // L-06
};

type Block<T extends BlockType = BlockType> = {
  id: Id; type: T; name?: string;
  frame: { x: number; y: number; w: number; h: number; rotation: number; flipX?: boolean; flipY?: boolean };
  z: number; locked?: boolean; hidden?: boolean; groupId?: Id;
  style: BlockStyle;                       // S-01..S-11
  animation?: { enter?: EnterAnim; loop?: LoopAnim; press?: PressAnim };   // S-12..S-14
  states?: Partial<Record<'hover' | 'pressed' | 'selected' | 'correct' | 'wrong' | 'disabled', Partial<BlockStyle>>>; // S-15
  visibleIf?: Condition;                   // S-16
  a11y?: { alt?: string; label?: string }; // S-17
  props: BlockPropsMap[T];                 // §6 спецификации
};

type Color = { hex: string /* #RRGGBBAA */ } | { token: ThemeColorToken; alpha?: number };
type Fill =
  | { kind: 'none' } | { kind: 'solid'; color: Color }
  | { kind: 'linear'; angle: number; stops: GradientStop[] }
  | { kind: 'radial'; cx: number; cy: number; stops: GradientStop[] }
  | { kind: 'media'; media: MediaRef; fit: 'cover' | 'contain' | 'fill'; focal?: { x: number; y: number } };
type Shape =
  | { kind: 'rect' } | { kind: 'pill' } | { kind: 'ellipse' }
  | { kind: 'polygon'; sides: number } | { kind: 'star'; points: number; depth: number }
  | { kind: 'heart' } | { kind: 'blob'; seed: number; complexity: number }
  | { kind: 'bubble'; tail: 'bl' | 'br' | 'tl' | 'tr' } | { kind: 'arrow' }
  | { kind: 'path'; d: string };          // нормализовано в 0..100, валидатор пути
```

Правила:
1. Каждое свойство из `01-PRODUCT-SPEC.md` §5 и §6 имеет поле в схеме, значение по умолчанию и ограничения (min/max/enum). Неизвестные поля отклоняются (`strict`).
2. Лимиты документа: ≤ 50 экранов, ≤ 100 блоков на экран, ≤ 20 вариантов в вопросе, текст блока ≤ 5000 символов, документ ≤ 2 МБ JSON.
3. **Публичная проекция** (`toPublicDocument`) — то, что получает браузер участника: без ключа правильных ответов, без баллов и тегов результатов, без служебных полей. Проверяется тестом «в публичной проекции нет ни одного поля `correct`, `score`, `resultTags`».
4. Миграции документа: при изменении схемы — новая `schemaVersion` и функция миграции с тестом на снимках старых документов (`packages/schema/test/fixtures`).

---

## 5. Модель данных (Prisma, черновик — финализируется в задаче P0.3)

```
User            id, phoneE164?, displayName, role(USER|MODERATOR|ADMIN), status(ACTIVE|BLOCKED|DELETED),
                ageConfirmedAt, timezone, email?, emailVerifiedAt?, totpSecretEnc?, createdAt, deletedAt?
AuthIdentity    id, userId, provider(PHONE|VK|YANDEX), providerUserId, createdAt     @@unique(provider, providerUserId)
Session         id, userId, tokenHash, createdAt, lastSeenAt, expiresAt, revokedAt?, ipHash, uaFamily
OtpRequest      id, phoneE164, codeHash, attempts, expiresAt, ipHash, createdAt       (лимиты и защита от СМС-фрода)
LegalDocument   id, type(TOS|OFFER|PRIVACY|PD_CONSENT_USER|DPA|COOKIES|CONTENT_RULES|MARKETING|COMPLAINTS),
                version, title, bodyMd, contentSha256, publishedAt, effectiveAt
ConsentRecord   id, subjectType(USER|PARTICIPANT), subjectId, legalDocumentId?, kind, acceptedAt, withdrawnAt?,
                ipHash, uaFamily, evidence(JSON: текст чекбокса, URL документа)
Project         id, ownerId, title, slug @unique, status, moderationStatus, ageRating(0|6|12|16|18),
                isAdvertising, adMarking(JSON: advertiser, inn, erid), operatorInfo(JSON для ПД), settings(JSON: лимиты, расписание,
                пароль-хэш, одна попытка), draftVersionId, publishedVersionId?, publishedAt?, closedReason?, createdAt, updatedAt, deletedAt?
ProjectVersion  id, projectId, number, document(JSONB), schemaVersion, sha256, createdAt, createdById, kind(DRAFT_SNAPSHOT|PUBLISHED)
Media           id, ownerId, kind(IMAGE|GIF|VIDEO|AUDIO|LOTTIE), status(UPLOADED|PROCESSING|READY|REJECTED|BLOCKED),
                mime, bytes, width?, height?, durationMs?, sha256, phash?, variants(JSON), moderation(JSON), createdAt, deletedAt?
AccessPoint     id, projectId, code @unique, kind(LINK|QR), label, qrStyle(JSON), active, createdAt
ParticipantSession id, projectId, versionId, accessPointId?, status, startedAt, completedAt?, lastActivityAt,
                deviceTokenHash?, ipHash, deviceType, score?, resultKey?, durationMs?, isPreview
Answer          id, sessionId, screenId, blockId, value(JSONB), answeredAt, timeOnScreenMs  @@unique(sessionId, blockId)
PlayEvent       id, sessionId, type(SCREEN_VIEW|ACTION|GAME_RESULT|LINK_OUT), payload(JSONB), at   (секционирование по месяцу)
ProjectStatsDaily projectId, date, accessPointId?, opens, starts, completions, avgDurationMs   @@id(projectId, date, accessPointId)
LimitCounter    projectId, kind(STARTS|COMPLETIONS), value     (зеркало Redis-счётчика, сверка задачей)
Plan            code, title, priceMonthRub, priceYearRub, limits(JSON), features(JSON), public, sort
Subscription    id, userId, planCode, period(MONTH|YEAR), status(TRIAL|ACTIVE|PAST_DUE|CANCELED|EXPIRED),
                currentPeriodStart, currentPeriodEnd, autoRenew, autoRenewConsentId?, paymentMethodRef?, canceledAt?
Order           id, userId, kind(SUBSCRIPTION|PASS|ADDON), item(JSON), amountKop, status(PENDING|PAID|CANCELED|REFUNDED),
                provider, providerPaymentId, receipt(JSON), createdAt, paidAt?
Entitlement     id, userId?, projectId?, feature, quantity?, validFrom, validTo, sourceOrderId?
UsageMonthly    userId, month, completions, storageBytes, smsSent
Report          id, projectId?, mediaId?, category, text, reporterContact?, reporterIpHash, status, slaDueAt, createdAt, resolvedAt?, resolution?
CopyrightClaim  id, projectId, claimant(JSON по ч.2 ст.15.7), objectDescription, urls, statement, attachments, status,
                receivedAt, clarifyRequestedAt?, dueAt, resolvedAt?, resolution
AuthorityRequest id, source, number, receivedAt, dueAt, subject, actions, closedAt?   (журнал запросов госорганов, ведёт админ)
ModerationAction id, targetType(PROJECT|MEDIA|USER), targetId, action(WARN|UNPUBLISH|BLOCK|DELETE|RESTORE|LEGAL_HOLD),
                reasonCode, note, actorId, createdAt
DataSubjectRequest id, kind(ACCESS|DELETE|WITHDRAW), subjectContact, projectId?, status, receivedAt, dueAt, closedAt?
AuditLog        id, actorId?, action, targetType, targetId, ipHash, meta(JSON), createdAt   (только добавление)
FeatureFlag     key, enabled, note                       (в т.ч. аварийные выключатели AD-07)
```

`ipHash` = HMAC-SHA256(IP, суточная соль) — для антиспама и лимитов без хранения IP в открытом виде. Если владелец по итогам юридической консультации решит, что сервис — ОРИ (`05-LEGAL.md` §2.6), включается отдельный журнал `CommsMetaLog` с открытыми IP и сроками хранения по закону — это предусмотрено флагом и задачей P8.9.

---

## 6. API (основные группы, `/api/v1`)

| Группа | Эндпоинты (не исчерпывающе) |
|---|---|
| `auth` | `POST /auth/otp/request`, `POST /auth/otp/verify`, `GET /auth/oauth/:provider/start`, `GET /auth/oauth/:provider/callback`, `POST /auth/logout`, `GET/DELETE /auth/sessions` |
| `me` | `GET/PATCH /me`, `POST /me/consents`, `POST /me/export`, `DELETE /me` |
| `projects` | CRUD, `PUT /projects/:id/draft` (If-Match версия), `POST /projects/:id/publish` (предпубликационная проверка), `POST /projects/:id/close`, `GET /projects/:id/versions`, `POST /projects/:id/restore/:versionId`, `POST /projects/from-template/:templateId` |
| `media` | `POST /media` (загрузка, по частям для > 20 МБ), `GET /media`, `DELETE /media/:id` |
| `access` | CRUD точек доступа, `GET /access/:id/qr.(png|svg|pdf)` |
| `play` (публичный) | `GET /play/:slug` (публичная проекция опубликованной версии + состояние доступа), `POST /play/:projectId/sessions`, `POST /play/sessions/:id/answers` (идемпотентно, `clientEventId`), `POST /play/sessions/:id/check` (проверка ответа с ключом), `POST /play/sessions/:id/complete`, `POST /play/sessions/:id/events`, `POST /play/wheel/:sessionId/:blockId/spin` |
| `responses` | `GET /projects/:id/sessions` (фильтры, пагинация по курсору), `GET /sessions/:id`, `DELETE /sessions/:id`, `POST /projects/:id/export` |
| `analytics` | `GET /projects/:id/analytics?from&to&accessPoint` |
| `billing` | `GET /plans`, `POST /billing/checkout`, `POST /billing/webhook/:provider`, `GET /billing/orders`, `PATCH /billing/subscription` (автопродление вкл/выкл), `POST /billing/pass` |
| `reports` (публичный) | `POST /reports`, `POST /copyright-claims`, `POST /data-requests` |
| `legal` (публичный) | `GET /legal/:type` (актуальная версия), `GET /legal/:type/:version` |
| `admin` | пользователи, модерация, журналы, тарифы, флаги, документы, аудит |
| служебные | `GET /health` (БД, Redis, место на диске), `GET /out?u=` (безопасный переход — в web) |

Общие правила API: валидация входа zod-схемами; ошибки в едином формате `{ error: { code, message, details? } }` с русским `message`; пагинация курсором; все списки ограничены; каждый эндпоинт кабинета проверяет, что ресурс принадлежит текущему пользователю (тест IDOR на каждый — P9.4).

---

## 7. Фоновые задачи (`apps/worker`)

| Очередь | Задачи |
|---|---|
| `media` | проверка сигнатуры, ClamAV, удаление EXIF, варианты изображений (WebP/AVIF 480/960/1920), GIF → MP4 + WebM + постер, транскодирование видео (H.264, 720p; 1080p на Про), аудио → AAC/Opus, проверка Lottie (размер, без внешних ссылок), pHash |
| `moderation` | NSFW-классификатор изображений и ключевых кадров видео, сверка pHash со стоп-базой, текстовые стоп-слова для опубликованных версий, проверка ссылок |
| `notify` | письма, СМС-коды, Telegram, вебхуки (с подписью HMAC и повторами) |
| `export` | CSV/XLSX выгрузки ответов |
| `stats` | сводки `ProjectStatsDaily`, сверка счётчиков лимитов Redis ↔ БД |
| `billing` | напоминания перед окончанием периода, повтор неудачных списаний (только при включённом автопродлении), понижение тарифа по окончании |
| `retention` | удаление ответов по сроку хранения тарифа, жёсткое удаление удалённых сборок/аккаунтов через 30 дней, очистка временных файлов, акты уничтожения ПД (запись в журнал) |
| `backup` | ежедневный `pg_dump` + медиа (инкрементально), шифрование, выгрузка в S3 РФ, ротация, отчёт администратору |

Каждая задача идемпотентна, имеет ограничение попыток и попадает в журнал ошибок с уведомлением администратору при окончательном провале.

---

## 8. Безопасность (обязательный минимум)

1. **Сеансы**: непрозрачный токен в cookie `HttpOnly; Secure; SameSite=Lax`, в БД — только хэш; CSRF — проверка `Origin` + заголовок `X-Requested-With` для изменяющих запросов.
2. **Заголовки**: строгий CSP (без `unsafe-eval`; inline только с nonce), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS; плеер и медиа-домен — отдельные политики.
3. **Пользовательские файлы**: отдаются только с медиа-домена, с корректным `Content-Type` по сигнатуре, `Content-Disposition: inline` только для медиа, SVG от пользователей **не принимаются** (только из библиотеки тем), HTML/JS от пользователей **не принимаются вообще**.
4. **Лимиты частоты** на nginx и в приложении: вход, СМС (на номер, на IP, суточный бюджет, запрет зарубежных номеров по умолчанию), создание прохождений, ответы, жалобы, загрузки.
5. **SSRF**: сервер не скачивает файлы по ссылкам пользователей. Единственный исходящий запрос с пользовательским URL — к Yandex Safe Browsing.
6. **Секреты** только в `.env.prod`; в CI — gitleaks; в логах маскирование телефонов, токенов, кодов.
7. **Платёжные данные** не проходят через наши серверы (страница/виджет провайдера), вебхуки проверяются по подписи/IP провайдера и идемпотентны.
8. **Резервные копии** зашифрованы (`age`), ключ хранится у владельца отдельно; восстановление проверяется ежемесячно (`backup-check.yml`).
9. **Админка**: телефон + TOTP, журнал аудита, отдельный префикс маршрутов, ограничение по ролям на каждом эндпоинте.

---

## 9. Наблюдаемость

Структурные логи (pino, JSON) с идентификатором запроса; маскирование ПД; ротация через pm2-logrotate (если не установлен — задача владельцу). Метрики и тревоги минимального уровня: всплеск 5xx, падение задач очереди, заполнение диска > 80 %, недоставленные СМС, ошибки вебхуков оплаты → уведомление администратору (email + Telegram-бот администратора, если владелец его заведёт). Страница AD-09 показывает состояние.
