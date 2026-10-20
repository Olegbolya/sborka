# 02 · Архитектура «Блокума»

> Как устроена система и где она работает. Отступать от решений этого документа можно только с записью в `docs/DECISIONS.md` (дата, что меняем, почему, последствия).

---

## 1. Стек

| Слой | Технология | Почему |
|---|---|---|
| Монорепозиторий | pnpm workspaces + Turborepo, TypeScript `strict` везде | Тот же подход, что в BST, — проверен на этом сервере |
| Веб (лендинг, кабинет, редактор, плеер, админка) | **Next.js** (последняя стабильная, App Router), React 19 | SSR первого экрана плеера, OG-метаданные, одно приложение для всех страниц |
| API | **NestJS** (последняя стабильная) | Модули, guards, валидация — агенту проще держать порядок в большом API |
| Фоновые задачи | Node + **BullMQ** (Redis) — отдельный процесс `worker` | Медиа, модерация, экспорт, письма, очистка по срокам хранения, сводки аналитики |
| БД | **PostgreSQL 16** (уже стоит на сервере) + **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`, драйвер `pg`) | Типизированные запросы, SQL-миграции без внешних бинарников (ADR-016) |
| Кэш, очереди, счётчики | **Redis** (уже стоит на сервере), отдельный номер БД и префикс ключей | |
| Схема документа | **zod** в `packages/schema` | Одна схема для редактора, плеера, API и тестов |
| Состояние редактора | Zustand + Immer + история отмен (zundo или своя) | |
| Холст | DOM-рендер (не canvas) + `react-moveable` / `react-selecto` (MIT) для маркеров и рамки | Плеер и редактор рисуют блоки **одним** компонентом |
| Анимации | Motion (MIT), Lottie — **только** `@lottiefiles/dotlottie-web` (ThorVG: не выполняет выражения; `lottie-web` запрещён, TS-25), `canvas-confetti` (ISC), свои частицы на canvas | |
| Сценарии и поведения | Собственный движок `packages/engine/runtime`: детерминированная машина состояний (события → правила → действия), планировщик, пул копий, пространственная сетка для пересечений | Свобода создателя без «зашитых» игр; один код для предпросмотра, плеера и тестов |
| Свои шрифты | `subset-font` (HarfBuzz WASM) — перекодирование в WOFF2, `fontkit` — метаданные и покрытие кириллицы | TS-26 |
| Импорт контуров из SVG | строгий XML-парсер (`svgson`) + `svgpath` (нормализация); сохраняется только `d` | TS-27 |
| Палитра из картинки | `sharp` + k-means в worker | TH-02 |
| Форматированный текст | TipTap (MIT) с ограниченным набором отметок | |
| QR | `qr-code-styling` (MIT) в браузере + `qrcode` на сервере; декодер `jsqr` для проверки читаемости | |
| Медиа | `sharp` (изображения), системный `ffmpeg` (GIF→MP4/WebM, видео), `file-type` (проверка по сигнатуре), ClamAV (антивирус) | |
| Модерация изображений | Открытая NSFW-модель в ONNX (`onnxruntime-node`), запускается в worker | Без отправки картинок за рубеж |
| Графики | Recharts или ECharts | |
| Экспорт | `exceljs` (XLSX), свой CSV с BOM | |
| Тесты | Vitest (юнит), fast-check (свойства/фаззинг схемы), Supertest + реальный PostgreSQL (интеграция API и БД: каждый тестовый файл создаёт свою временную базу; локально — системный PostgreSQL 16 через `pnpm services`, в CI — сервис postgres), Playwright (e2e и скриншоты), Lighthouse CI (производительность плеера), k6 (нагрузка) | |

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
sborka/                        # репозиторий (рабочее имя); продукт — «Блокум»
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
│   ├── engine/                # flow: экраны, ветвление, баллы, результаты · runtime: сценарии, поведения, переменные (чистый TS, без React и DOM)
│   ├── themes/                # служебные темы для разработки, примеры RG-xx, данные стартовых тем/шаблонов для seed, шрифты платформы + манифест лицензий
│   ├── db/                    # схема Drizzle, SQL-миграции, клиент, seed
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

**Главное правило логики:** переходы, условия, баллы и результаты считаются только функциями `packages/engine/flow`, а сценарии и поведения исполняет только `packages/engine/runtime`. Сервер использует движок для проверки ответов и подсчёта результата, клиент — для навигации и игр. Ключ правильных ответов в клиентскую сборку не попадает (§4 п. 3).

**Главное правило свободы:** в коде нет логики, вёрстки или блоков, специфичных для конкретной игры, темы или шаблона. Если эталонную игру RG-xx нельзя собрать штатными средствами — дорабатывается движок или редактор, а не добавляется частный случай. Системные темы, шаблоны и библиотека — это данные в БД.

---

## 3. Размещение на сервере (рядом с BST)

Сервер: домашний, Ubuntu 24.04, `95.105.7.135`, пользователь `deploy`. На нём уже работает BST (`~/bst`, PM2 `bst-api` :3000, `bst-renderer` :3002, nginx-сайт `mybst.ru`, PostgreSQL, Redis, Node 20 через nvm).

| Что | Значение для «Блокума» |
|---|---|
| Каталог кода | `/home/deploy/blokum`: `repo.git` (голый репозиторий без учётных данных), `releases/<время>-<коммит>` (3 последних сборки), `current` → активный релиз, `shared/.env.prod`, `setup/infra` (скрипты для владельца) |
| Данные (медиа, экспорт, временные) | `/srv/blokum/{media,exports,tmp,quarantine}` (вне `/home`, чтобы nginx читал медиа, не открывая домашнюю папку) |
| Логи | `/home/deploy/logs/blokum-*.log` |
| Node | **Node 22 LTS** через nvm (`nvm install 22`); путь к интерпретатору явно в `ecosystem.config.cjs`. Node 20 у BST не трогаем |
| PM2 процессы | `blokum-api` (порт **3100**), `blokum-web` (порт **3110**), `blokum-worker` (без порта) |
| PostgreSQL | база `blokum_db`, пользователь `blokum` (отдельный от BST), подключение через `127.0.0.1` |
| Redis | номер БД **3**, префикс ключей `bk:`, префикс очередей BullMQ `bk` |
| nginx | отдельный файл `/etc/nginx/sites-available/blokum.conf` только со своими `server_name`; перед перезагрузкой всегда `nginx -t` |
| Домены | `blokum.ru` — сайт, кабинет, плеер, `/api/*` → api; `{МЕДИА-ДОМЕН}` — пользовательские файлы (**отдельный регистрируемый домен**, чтобы cookie основного сайта туда не уходили, решение 5 в `00-OWNER-DECISIONS.md`; на время разработки допустим поддомен `media.blokum.ru`) |
| Секреты | `/home/deploy/blokum/shared/.env.prod` (права 600), подключается через `node --env-file`; в git — только `infra/env.prod.example` |

**Запрещено на сервере:** `pm2 restart all`, `pm2 delete all`, `pm2 kill`, правка файлов BST, `nginx`-конфигов BST, базы `bst_db`, Redis БД BST, перезапуск PostgreSQL/Redis без согласования с владельцем.

### 3.1 Режим «до запуска»
Пока владелец не закрыл чек-лист запуска (`00-OWNER-DECISIONS.md` §3), весь сайт закрыт **базовой HTTP-авторизацией nginx** (логин/пароль у владельца) и переменной `PRELAUNCH=1` (регистрация только по приглашениям, баннер «Тестовый режим»). Снимает режим только владелец.

### 3.2 Однократная подготовка сервера
`infra/server-setup.sh` (идемпотентный, запускается владельцем через SSH один раз: `sudo bash infra/server-setup.sh`): создаёт каталоги, пользователя и базу PostgreSQL, ставит `ffmpeg`, `clamav` + `clamav-daemon`, Node 22 для `deploy`, sudoers-правило **только** для `nginx -t`, `systemctl reload nginx` и копирования `blokum.conf`, получает сертификаты certbot для доменов. Скрипт печатает, что сделал, и ничего не меняет у BST.

### 3.3 Деплой
- `ci.yml` — на каждый push и PR: установка, `pnpm verify`, e2e (Playwright) с postgres и redis в сервисах, Lighthouse CI для плеера, gitleaks.
- `deploy.yml` — на push в `main` **после** зелёного CI (`workflow_run`): SSH на сервер (секрет `DEPLOY_SSH_KEY`, тот же ключ, что у BST), `git fetch` по токену запуска, `infra/deploy.sh`: установка зависимостей, сборка, миграции (`pnpm db:migrate` — Drizzle, идемпотентно, плюс создание недостающих тарифов), перезапуск процессов **по одному** с проверкой `/api/health` и `/healthz`, откат на предыдущую сборку при провале.
- `server-diagnostics.yml` — ручной запуск: статус PM2 (только `blokum-*`), последние строки логов, место на диске, состояние очередей. Секреты не печатаются.
- Агент в облачной сессии **не имеет** прямого доступа к серверу: всё, что нужно на сервере, делается через эти workflow или через владельца.

---

## 4. Модель документа сборки (`packages/schema`)

Документ сборки — JSON, проверяемый zod-схемой. Ниже — контракт (точные схемы — в коде):

```ts
type ProjectDocument = {
  schemaVersion: 1;                        // миграции: packages/schema/src/migrations
  meta: { title: string; description?: string; ogImage?: MediaRef };
  artboard: { width: 390 };                // E-01
  theme: { themeId?: Id; tokens: ThemeTokens; overrides?: Partial<ThemeTokens> }; // TH-01: копия токенов в документе
  settings: { allowBack: boolean; showProgress: boolean; feedbackMode: 'instant' | 'end' | 'none'; soundEnabledByDefault: boolean };
  variables: Variable[];                   // VR-01
  rules: Rule[];                           // правила уровня сборки (SC-01)
  screens: Screen[];
  results: ResultRule[];                   // L-04
};

type Screen = {
  id: Id; name: string; kind: 'content' | 'question' | 'result';
  height: number;                          // 400..5000
  background: Fill[]; particles?: ParticlesConfig;   // P-xx
  blocks: Block[];
  transitionIn: TransitionRef;             // T-xx, T-32
  branches: BranchRule[];                  // L-02; пустой список = следующий экран
  rules: Rule[];                           // правила уровня экрана
  timer?: { seconds: number; onExpire: BranchTarget };  // L-06
};

type Block<T extends BlockType = BlockType> = {
  id: Id; type: T; name: string;           // имя — для выбора в правилах (S-17)
  frame: { x: number; y: number; w: number; h: number; rotation: number; flipX?: boolean; flipY?: boolean };
  z: number; locked?: boolean; hidden?: boolean; groupId?: Id;
  style: BlockStyle;                       // ОДИН тип для всех блоков: S-01..S-20 (S-00)
  textLayer?: RichText;                    // S-10: у любого блока
  animation?: { enter?: Anim; loop?: Anim; press?: Anim };        // S-12..S-14, в т.ч. keyframes
  states?: Partial<Record<BlockState, Partial<BlockStyle>>>;       // S-15
  visibleIf?: Condition;                   // S-16
  behaviors?: Behavior[];                  // BH-01..BH-08
  rules?: Rule[];                          // правила уровня блока
  children?: Block[];                      // B-21, варианты B-11/B-12, стороны BH-07 (S-20 раскладка)
  a11y?: { alt?: string; label?: string };
  props: BlockPropsMap[T];                 // §6 спецификации
};

type Rule = {
  id: Id; name?: string; enabled: boolean; once: boolean; priority: number;
  when: Trigger;                           // TR-01..TR-16 (+ источник: блок | «любая копия блока» | экран | зона)
  if?: ConditionGroup;                     // CN-01..CN-06
  do: Action[];                            // AC-01..AC-20, последовательно; If/Else и Repeat — тоже действия
};
type Behavior =
  | { kind: 'drag'; axis?: 'x' | 'y'; bounds?: Rect; snapToZones?: Id[]; returnIfMissed?: boolean }
  | { kind: 'flee'; distance: number; speed: number; times: number }
  | { kind: 'scratch'; brush: number; threshold: number }
  | { kind: 'move'; angle: number; speed: number; spread: number; gravity?: number; edge: 'bounce' | 'destroy' | 'wrap'; path?: string }
  | { kind: 'spawner'; prototypeId: Id; everyMs: number; area: Rect; max: number }
  | { kind: 'wheel'; sectors: { blockId: Id; weight: number }[] }    // веса не попадают в публичную проекцию
  | { kind: 'flip'; frontId: Id; backId: Id; on: 'tap' | 'action' }
  | { kind: 'follow'; lagMs: number; bounds?: Rect };
type Variable = { id: Id; name: string; type: 'number' | 'text' | 'bool' | 'list'; initial: unknown; saveToAnswers: boolean };

type Color = { hex: string /* #RRGGBBAA */ } | { token: ThemeColorToken; alpha?: number };
type Fill =
  | { kind: 'none' } | { kind: 'solid'; color: Color }
  | { kind: 'linear' | 'radial' | 'conic'; angle?: number; cx?: number; cy?: number; stops: GradientStop[] }
  | { kind: 'media'; media: MediaRef | LibraryRef; fit: 'cover' | 'contain' | 'fill' | 'tile'; focal?: Point; scale?: number };
type Shape =
  | { kind: 'rect' } | { kind: 'pill' } | { kind: 'ellipse' }
  | { kind: 'polygon'; sides: number; cornerRadius?: number } | { kind: 'star'; points: number; depth: number; cornerRadius?: number }
  | { kind: 'heart' } | { kind: 'blob'; seed: number; complexity: number }
  | { kind: 'bubble'; tail: Point } | { kind: 'arrow'; thickness: number; head: 'triangle' | 'round' }
  | { kind: 'wave'; amplitude: number; frequency: number; edges: Edge[] }
  | { kind: 'path'; d: string; closed: boolean };   // E-21: нормализовано в 0..100

type ThemeTokens = {
  colors: Record<string, string>;          // свои + смысловые роли
  fonts: { heading: FontRef; body: FontRef; accent?: FontRef };
  background: Fill[]; particles?: ParticlesConfig;
  blockDefaults: Partial<Record<BlockType, Partial<BlockStyle>>>;  // стиль по умолчанию каждого типа блока
  transitions: TransitionPreset[]; decor: MediaRef[]; sounds: Record<string, MediaRef>;
  systemScreens: { closed: Partial<Screen>; password: Partial<Screen>; age18: Partial<Screen> };
};
```

Правила:
1. Каждое свойство и каждый элемент сценариев из `01-PRODUCT-SPEC.md` §5–§8 имеет поле в схеме, значение по умолчанию и ограничения. Неизвестные поля отклоняются (`strict`).
2. Лимиты: ≤ 50 экранов, ≤ 100 блоков на экран (без учёта копий в прохождении), ≤ 30 вариантов, ≤ 1000 правил (тарифные лимиты — ниже), текст блока ≤ 5000 символов, документ ≤ 3 МБ JSON.
3. **Публичная проекция** (`toPublicDocument`) — то, что получает браузер участника: без ключа правильных ответов, баллов, тегов результатов, весов колеса, `operatorInfo`, служебных полей. Тест: в проекции нет полей `correct`, `score`, `resultTags`, `weight`.
4. Миграции документа: новая `schemaVersion` + функция миграции + тест на снимках старых документов.
5. Публикация копирует `theme.tokens` в опубликованную версию (снимок), поэтому правка темы не меняет уже опубликованное.

---

## 5. Модель данных (реализована в P0.3: `packages/db/src/schema`, Drizzle)

```
User            id, phoneE164?, displayName, role(USER|MODERATOR|ADMIN), status(ACTIVE|BLOCKED|DELETED),
                ageConfirmedAt, timezone, email?, emailVerifiedAt?, totpSecretEnc?, createdAt, deletedAt?
AuthIdentity    id, userId, provider(PHONE|VK|YANDEX), providerUserId, createdAt     @@unique(provider, providerUserId)
Session         id, userId, tokenHash, createdAt, lastSeenAt, expiresAt, revokedAt?, ipHash, uaFamily
OtpRequest      id, phoneE164, codeHash, attempts, expiresAt, ipHash, createdAt
LegalDocument   id, type(TOS|OFFER|PRIVACY|PD_CONSENT_USER|DPA|COOKIES|CONTENT_RULES|MARKETING|COMPLAINTS),
                version, title, bodyMd, contentSha256, publishedAt, effectiveAt
ConsentRecord   id, subjectType(USER|PARTICIPANT), subjectId, legalDocumentId?, kind, acceptedAt, withdrawnAt?, ipHash, uaFamily, evidence(JSON)
Project         id, ownerId, title, slug @unique, status, moderationStatus, ageRating(0|6|12|16|18), isAdvertising, adMarking(JSON),
                operatorInfo(JSON), settings(JSON: лимиты, расписание, пароль-хэш, одна попытка), themeId?, draftVersionId,
                publishedVersionId?, publishedAt?, closedReason?, createdAt, updatedAt, deletedAt?
ProjectVersion  id, projectId, number, document(JSONB, включая снимок токенов темы), schemaVersion, sha256, createdAt, createdById,
                kind(DRAFT_SNAPSHOT|PUBLISHED)
Theme           id, ownerId? (null = системная), name, tokens(JSONB), coverMediaId?, isSystem, publishedAt?, createdAt, deletedAt?
Template        id, ownerId? (null = системный), name, category?, coverMediaId?, document(JSONB), sourceProjectId?, isSystem,
                sort, publishedAt?, createdAt, deletedAt?
SavedElement    id, ownerId, name, coverMediaId?, fragment(JSONB: блоки + правила + переменные), createdAt, deletedAt?
Font            id, ownerId? (null = платформа/библиотека), family, styles(JSON: начертание → mediaId woff2), hasCyrillic, license?, createdAt
Media           id, ownerId, kind(IMAGE|GIF|VIDEO|AUDIO|LOTTIE|FONT_SOURCE), status(UPLOADED|PROCESSING|READY|REJECTED|BLOCKED),
                mime, bytes, width?, height?, durationMs?, sha256, phash?, palette?(JSON), variants(JSON), moderation(JSON), createdAt, deletedAt?
LibraryCollection id, kind(STICKERS|REACTIONS|BACKGROUNDS|SOUNDS|FONTS|ANIMATIONS), title, sort, active
LibraryItem     id, collectionId, mediaId? | fontId?, title, tags[], license(OWN|OFL|CC0|MIT|APACHE|CC_BY|LICENSED), author, source,
                attribution?, rightsConfirmedById, rightsConfirmedAt, active, withdrawnAt?, withdrawReason?
AccessPoint     id, projectId, code @unique, kind(LINK|QR), label, qrStyle(JSON), active, createdAt
ParticipantSession id, projectId, versionId, accessPointId?, status, startedAt, completedAt?, lastActivityAt, deviceTokenHash?, ipHash,
                deviceType, score?, resultKey?, durationMs?, runtimeState?(JSONB для продолжения после перезагрузки), isPreview
Answer          id, sessionId, screenId?, blockId?, variableId?, source(QUESTION|VARIABLE|ACTION), value(JSONB), deviceReported(bool),
                answeredAt, timeOnScreenMs                   @@unique(sessionId, blockId), @@unique(sessionId, variableId)
RandomDraw      id, sessionId, sourceId (блок или правило), outcome(JSONB), createdAt   @@unique(sessionId, sourceId, seq)   (RN-01)
PlayEvent       id, sessionId, type(SCREEN_VIEW|ACTION|LINK_OUT|RULE_LIMIT), payload(JSONB), at   (секционирование по месяцу)
ProjectStatsDaily projectId, date, accessPointId?, opens, starts, completions, avgDurationMs   @@id(projectId, date, accessPointId)
LimitCounter    projectId, kind(STARTS|COMPLETIONS), value
Plan            code, title, priceMonthRub, priceYearRub, limits(JSON), features(JSON), public, sort
Subscription    id, userId, planCode, period(MONTH|YEAR), status(TRIAL|ACTIVE|PAST_DUE|CANCELED|EXPIRED), currentPeriodStart, currentPeriodEnd,
                renewMode(AUTO|LINK), autoRenewConsentId?, paymentMethodRef?, canceledAt?
Order           id, userId, kind(SUBSCRIPTION|PASS|ADDON), item(JSON), amountKop, payerType(PERSON|BUSINESS), payerInn?,
                status(PENDING|PAID|CANCELED|REFUNDED), provider, providerPaymentId, receipt(JSON), createdAt, paidAt?
Entitlement     id, userId?, projectId?, feature, quantity?, validFrom, validTo, sourceOrderId?
UsageMonthly    userId, month, completions, storageBytes, smsSent
Report · CopyrightClaim · AuthorityRequest · ModerationAction · DataSubjectRequest · AuditLog · FeatureFlag — как в `06-TRUST-SAFETY.md` и `05-LEGAL.md`
                (ModerationAction.targetType дополнительно: THEME | TEMPLATE | LIBRARY_ITEM | FONT)
```

`ipHash` = HMAC-SHA256(IP, суточная соль). Режим ОРИ (если владелец включит по итогам консультации, `05-LEGAL.md` §2.6) добавляет журнал `CommsMetaLog` — задача P8.9. Доход самозанятого (AD-12) считается из `Order` (`payerType`, `paidAt`, возвраты вычитаются).

---

## 6. API (основные группы, `/api/v1`)

| Группа | Эндпоинты (не исчерпывающе) |
|---|---|
| `auth` | `POST /auth/otp/request`, `POST /auth/otp/verify`, `GET /auth/oauth/:provider/start`, `GET /auth/oauth/:provider/callback`, `POST /auth/logout`, `GET/DELETE /auth/sessions` |
| `me` | `GET/PATCH /me`, `POST /me/consents`, `POST /me/export`, `DELETE /me` |
| `projects` | CRUD, `PUT /projects/:id/draft` (If-Match), `POST /projects/:id/publish`, `POST /projects/:id/close`, `GET /projects/:id/versions`, `POST /projects/:id/restore/:versionId`, `POST /projects/from-template/:templateId` |
| `themes` | `GET /themes?scope=mine|system`, CRUD своих тем, `POST /themes/from-project/:projectId`, `POST /themes/from-image` (палитра), `POST /themes/:id/duplicate` |
| `templates` | `GET /templates?scope=mine|system&category=&q=`, `POST /templates/from-project/:projectId`, CRUD своих |
| `elements` | CRUD «Моих элементов» |
| `fonts` | `POST /fonts` (загрузка, перекодирование), `GET /fonts?scope=mine|library`, `DELETE /fonts/:id` |
| `media` | `POST /media` (по частям для > 20 МБ), `GET /media`, `DELETE /media/:id`, `POST /media/svg-contour` (импорт контура → `d`) |
| `library` | `GET /library/collections`, `GET /library/items?collection=&q=&tags=` |
| `access` | CRUD точек доступа, `GET /access/:id/qr.(png|svg|pdf)` |
| `play` (публичный) | `GET /play/:slug`, `POST /play/:projectId/sessions`, `POST /play/sessions/:id/answers` (идемпотентно, `clientEventId`), `POST /play/sessions/:id/values` (AC-14, VR-04), `POST /play/sessions/:id/check`, `POST /play/sessions/:id/random` (RN-01), `PUT /play/sessions/:id/state` (продолжение), `POST /play/sessions/:id/complete`, `POST /play/sessions/:id/events` |
| `responses` | `GET /projects/:id/sessions`, `GET /sessions/:id`, `DELETE /sessions/:id`, `POST /projects/:id/export` |
| `analytics` | `GET /projects/:id/analytics?from&to&accessPoint` |
| `billing` | `GET /plans`, `POST /billing/checkout`, `POST /billing/webhook/:provider`, `GET /billing/orders`, `PATCH /billing/subscription`, `POST /billing/renew-link`, `POST /billing/pass` |
| `reports` (публичный) | `POST /reports`, `POST /copyright-claims`, `POST /data-requests` |
| `legal` (публичный) | `GET /legal/:type`, `GET /legal/:type/:version` |
| `admin` | пользователи, модерация, журналы, тарифы, флаги, документы, аудит, библиотека (AD-10), системные темы и шаблоны (AD-11), доход НПД (AD-12) |
| служебные | `GET /health`, `GET /out?u=` (в web) |

Общие правила: валидация zod-схемами; ошибки `{ error: { code, message, details? } }` с русским `message`; пагинация курсором; все списки ограничены; каждый эндпоинт кабинета проверяет владельца ресурса (тест IDOR на каждый — P9.4).

---

## 7. Фоновые задачи (`apps/worker`)

| Очередь | Задачи |
|---|---|
| `media` | проверка сигнатуры, ClamAV, удаление EXIF, варианты изображений (WebP/AVIF 480/960/1920), GIF → MP4 + WebM + постер, видео (H.264 720p; 1080p на Про), аудио → AAC/Opus, очистка Lottie (TS-25), перекодирование шрифтов в WOFF2 (TS-26), импорт контура из SVG (TS-27), палитра изображения (TH-02), pHash |
| `moderation` | NSFW-классификатор изображений и кадров видео, сверка pHash со стоп-базой, стоп-слова для опубликованных версий (включая тексты из действий AC-02), проверка ссылок |
| `notify` | письма, СМС-коды, Telegram, вебхуки (подпись HMAC, повторы) |
| `export` | CSV/XLSX выгрузки |
| `stats` | сводки `ProjectStatsDaily`, сверка счётчиков лимитов |
| `billing` | напоминания перед окончанием периода, автоплатежи (только `renewMode=AUTO` с согласием), ссылки на продление, понижение тарифа, пересчёт дохода НПД и тревоги AD-12 |
| `retention` | удаление ответов по сроку, жёсткое удаление через 30 дней, очистка временных файлов, журнал уничтожения ПД |
| `library` | разбор ZIP + CSV лицензий, снятие единиц и замена заглушкой (LB-04), уведомления создателей |
| `backup` | ежедневный `pg_dump` + медиа, шифрование, выгрузка в S3 РФ, ротация, отчёт |

Каждая задача идемпотентна, с ограничением попыток и тревогой при окончательном провале.

---

## 8. Безопасность (обязательный минимум)

1. **Сеансы**: непрозрачный токен в cookie `HttpOnly; Secure; SameSite=Lax`, в БД — хэш; CSRF — проверка `Origin` + заголовок для изменяющих запросов.
2. **Заголовки**: строгий CSP (без `unsafe-eval`; inline только с nonce), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (датчики движения — только для страниц плеера), HSTS.
3. **Пользовательские файлы**: только с медиа-домена, `Content-Type` по сигнатуре; HTML/JS/SVG от пользователей не хранятся и не показываются (из SVG берётся только контур, TS-27); Lottie — только через `dotlottie-web` после очистки (TS-25); шрифты — только перекодированные (TS-26).
4. **Сценарии**: движок не исполняет пользовательский код — только перечисленные в схеме триггеры, условия и действия; открытие ссылок и копирование — только по жесту участника (TS-07); лимиты шагов (SC-04).
5. **Лимиты частоты** на nginx и в приложении: вход, СМС, создание прохождений, ответы, розыгрыши RN-01, жалобы, загрузки.
6. **SSRF**: сервер не скачивает файлы по ссылкам пользователей; единственный исходящий запрос с пользовательским URL — к Yandex Safe Browsing.
7. **Секреты** только в `.env.prod`; gitleaks в CI; маскирование в логах.
8. **Платёжные данные** не проходят через наши серверы; вебхуки проверяются и идемпотентны.
9. **Резервные копии** зашифрованы (`age`), ключ у владельца; восстановление проверяется ежемесячно.
10. **Админка**: телефон + TOTP, аудит, проверка роли на каждом эндпоинте.

---

## 9. Наблюдаемость

Структурные логи (pino, JSON) с идентификатором запроса; маскирование ПД; ротация через pm2-logrotate (если не установлен — задача владельцу). Метрики и тревоги минимального уровня: всплеск 5xx, падение задач очереди, заполнение диска > 80 %, недоставленные СМС, ошибки вебхуков оплаты → уведомление администратору (email + Telegram-бот администратора, если владелец его заведёт). Страница AD-09 показывает состояние.
