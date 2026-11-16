import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './columns.js';
import { accessPoints, projectVersions, projects } from './projects.js';
import { answerSource, deviceType, limitKind, playEventType, sessionStatus } from './enums.js';

export const participantSessions = pgTable(
  'participant_sessions',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    versionId: text('version_id')
      .notNull()
      .references(() => projectVersions.id, { onDelete: 'cascade' }),
    accessPointId: text('access_point_id').references(() => accessPoints.id, { onDelete: 'set null' }),
    status: sessionStatus('status').notNull().default('IN_PROGRESS'),
    startedAt: ts('started_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
    lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
    deviceTokenHash: text('device_token_hash'),
    ipHash: text('ip_hash'),
    deviceType: deviceType('device_type').notNull().default('UNKNOWN'),
    score: integer('score'),
    resultKey: text('result_key'),
    durationMs: integer('duration_ms'),
    runtimeState: jsonb('runtime_state').$type<Record<string, unknown>>(),
    isPreview: boolean('is_preview').notNull().default(false),
    viewedAt: ts('viewed_at'),
  },
  (t) => [
    index('psessions_project_started_idx').on(t.projectId, t.startedAt),
    index('psessions_project_status_idx').on(t.projectId, t.status),
    index('psessions_device_idx').on(t.projectId, t.deviceTokenHash),
    index('psessions_access_point_idx').on(t.accessPointId),
    index('psessions_ip_started_idx').on(t.ipHash, t.startedAt),
  ],
);

export const answers = pgTable(
  'answers',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => participantSessions.id, { onDelete: 'cascade' }),
    screenId: text('screen_id'),
    blockId: text('block_id'),
    variableId: text('variable_id'),
    source: answerSource('source').notNull(),
    value: jsonb('value').notNull(),
    deviceReported: boolean('device_reported').notNull().default(false),
    answeredAt: ts('answered_at').notNull().defaultNow(),
    timeOnScreenMs: integer('time_on_screen_ms'),
    /** PL-12 · what the browser calls this event and when it happened: a repeat of the same event changes nothing, an older one never overwrites a newer. */
    clientEventId: text('client_event_id'),
    clientTs: bigint('client_ts', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('answers_session_event_uq').on(t.sessionId, t.clientEventId).where(sql`${t.clientEventId} IS NOT NULL`),
    uniqueIndex('answers_session_block_uq').on(t.sessionId, t.blockId).where(sql`${t.blockId} IS NOT NULL`),
    uniqueIndex('answers_session_variable_uq').on(t.sessionId, t.variableId).where(sql`${t.variableId} IS NOT NULL`),
  ],
);

/** PL-26, D-12 · the creator frees an option a passage holds (B-24): the place goes back to the others, the answer itself stays as it was. */
export const choiceReleases = pgTable(
  'choice_releases',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => participantSessions.id, { onDelete: 'cascade' }),
    optionId: text('option_id').notNull(),
    releasedAt: ts('released_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.optionId] })],
);

/** Server-side random draws that affect results (RN-01): fixed before the animation is shown. */
export const randomDraws = pgTable(
  'random_draws',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => participantSessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    seq: integer('seq').notNull().default(0),
    outcome: jsonb('outcome').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('random_draws_uq').on(t.sessionId, t.sourceId, t.seq)],
);

export const playEvents = pgTable(
  'play_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => participantSessions.id, { onDelete: 'cascade' }),
    type: playEventType('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('play_events_session_at_idx').on(t.sessionId, t.at), index('play_events_at_idx').on(t.at)],
);

/** Daily aggregates for analytics (D-05). `accessPointId = ''` is the total over all access points. */
export const projectStatsDaily = pgTable(
  'project_stats_daily',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    accessPointId: text('access_point_id').notNull().default(''),
    opens: integer('opens').notNull().default(0),
    starts: integer('starts').notNull().default(0),
    completions: integer('completions').notNull().default(0),
    avgDurationMs: integer('avg_duration_ms'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.day, t.accessPointId] })],
);

/** Mirror of the atomic Redis limit counters (PL-06), reconciled by the `stats` queue. */
export const limitCounters = pgTable(
  'limit_counters',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: limitKind('kind').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.kind] })],
);

/**
 * D-13…D-21 · the board («табло») of a project: a public page `/b/{code}` with the standings of finished passages.
 * One board per project. `resetAt` starts a new round: only passages finished after it count.
 */
export const boards = pgTable(
  'boards',
  {
    projectId: text('project_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** The address of the public page: not guessable, not linked to the address of the passage. */
    code: text('code').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    /** 'teams' — by the answer to a choice question; 'participants' — by a nick from a text question. */
    groupBy: text('group_by').notNull().default('participants'),
    /** 'score' — the points of the passage (L-03); 'variable' — the value of a number variable saved into the answers (VR-04). */
    metric: text('metric').notNull().default('score'),
    metricVariableId: text('metric_variable_id'),
    /** For teams: the sum or the average of the team. */
    aggregate: text('aggregate').notNull().default('sum'),
    teamBlockId: text('team_block_id'),
    nickBlockId: text('nick_block_id'),
    /** The consent «Показывать моё имя на табло»: a nick is shown only when this answer is «да». */
    consentBlockId: text('consent_block_id'),
    /** The button «Открыть табло» on the last screen of the passage. */
    showOnFinish: boolean('show_on_finish').notNull().default(true),
    frozenAt: ts('frozen_at'),
    resetAt: ts('reset_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('boards_code_uq').on(t.code)],
);

/** D-19 · a row the creator hid from the board: a session id (participants) or the name of a team. */
export const boardHidden = pgTable(
  'board_hidden',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    rowKey: text('row_key').notNull(),
    hiddenAt: ts('hidden_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.rowKey] })],
);
