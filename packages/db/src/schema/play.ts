import { sql } from 'drizzle-orm';
import { bigserial, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
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
  },
  (t) => [
    index('psessions_project_started_idx').on(t.projectId, t.startedAt),
    index('psessions_project_status_idx').on(t.projectId, t.status),
    index('psessions_device_idx').on(t.projectId, t.deviceTokenHash),
    index('psessions_access_point_idx').on(t.accessPointId),
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
  },
  (t) => [
    uniqueIndex('answers_session_block_uq').on(t.sessionId, t.blockId).where(sql`${t.blockId} IS NOT NULL`),
    uniqueIndex('answers_session_variable_uq').on(t.sessionId, t.variableId).where(sql`${t.variableId} IS NOT NULL`),
  ],
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
