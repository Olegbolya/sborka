import { HttpException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { type ProjectDocument, type PublicDocument, type ThemeTokens, toPublicDocument } from '@blokum/schema';
import { DB } from '../tokens.js';
import { LocalStorageService } from '../media/storage.js';
import { type ProjectSettings } from '../projects/projects.service.js';

/** The first state a participant meets (docs/01-PRODUCT-SPEC.md §10.3). */
export type PlayView = PlayOpen | PlayBlocked;

export interface PlayOpen {
  state: 'ok';
  projectId: string;
  versionId: string;
  slug: string;
  title: string;
  description: string;
  /** Own picture for link previews (PL-04): a media file of the published version. */
  ogImageId: string | null;
  /** noindex by default (PL-05); a paid tariff may allow indexing. */
  indexable: boolean;
  document: PublicDocument;
  /** Kinds of the media the document refers to, so the player draws a picture, a video or a sound as it should. */
  media: Record<string, { kind: string; mime: string }>;
}

export interface PlayBlocked {
  state: 'not_open' | 'closed';
  slug: string;
  title: string;
  /** What the creator wrote for this state, or the standard text. */
  text: string;
  opensAt?: string;
  theme: ThemeTokens;
}

const unavailable = (): HttpException => new HttpException({ error: { code: 'UNAVAILABLE', message: 'Недоступно' } }, 404);

/** PL-01…PL-05, §10.3 · what the player reads: the published copy of a project and whether it can be opened now. */
@Injectable()
export class PlayService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: LocalStorageService,
  ) {}

  private async published(slug: string) {
    const [row] = await this.db
      .select({
        id: schema.projects.id,
        ownerId: schema.projects.ownerId,
        slug: schema.projects.slug,
        title: schema.projects.title,
        status: schema.projects.status,
        moderationStatus: schema.projects.moderationStatus,
        settings: schema.projects.settings,
        versionId: schema.projectVersions.id,
        document: schema.projectVersions.document,
      })
      .from(schema.projects)
      .innerJoin(schema.projectVersions, eq(schema.projects.publishedVersionId, schema.projectVersions.id))
      .where(and(eq(schema.projects.slug, slug), isNull(schema.projects.deletedAt)));
    // 1. Exists, published, not blocked — otherwise «Недоступно» without telling why.
    if (!row || row.status !== 'PUBLISHED' || row.moderationStatus === 'BLOCKED') throw unavailable();
    return { ...row, doc: row.document as unknown as ProjectDocument, settings: (row.settings ?? {}) as ProjectSettings };
  }

  async view(slug: string, now = new Date()): Promise<PlayView> {
    const p = await this.published(slug);
    const blocked = (state: PlayBlocked['state'], text: string, opensAt?: string): PlayBlocked => ({
      state,
      slug: p.slug,
      title: p.title,
      text,
      ...(opensAt ? { opensAt } : {}),
      theme: p.doc.theme.tokens,
    });
    // 2. Schedule: before the start «Откроется …», after the end «Сборка закрыта».
    const opens = p.settings.scheduledOpenAt ? new Date(p.settings.scheduledOpenAt) : null;
    const closes = p.settings.scheduledCloseAt ? new Date(p.settings.scheduledCloseAt) : null;
    if (opens && now < opens) return blocked('not_open', `Откроется ${opens.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long', timeStyle: 'short' })} (МСК)`, opens.toISOString());
    if (closes && now >= closes) return blocked('closed', p.settings.closedText?.trim() || p.doc.theme.tokens.systemScreens.closed.text || 'Сборка закрыта');
    const media = await this.mediaOf(p.ownerId, p.doc);
    return {
      state: 'ok',
      projectId: p.id,
      versionId: p.versionId,
      slug: p.slug,
      title: p.doc.meta.title,
      description: p.doc.meta.description,
      ogImageId: p.doc.meta.ogImage?.source === 'media' ? p.doc.meta.ogImage.id : null,
      indexable: false,
      document: toPublicDocument(p.doc),
      media,
    };
  }

  /** Media of the owner that the document refers to (`{source:'media', id}` anywhere in it). */
  private async mediaOf(ownerId: string, doc: ProjectDocument): Promise<PlayOpen['media']> {
    const ids = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (o.source === 'media' && typeof o.id === 'string') ids.add(o.id);
        Object.values(o).forEach(walk);
      }
    };
    walk(doc);
    if (ids.size === 0) return {};
    const rows = await this.db
      .select({ id: schema.media.id, kind: schema.media.kind, mime: schema.media.mime, status: schema.media.status })
      .from(schema.media)
      .where(and(eq(schema.media.ownerId, ownerId), inArray(schema.media.id, [...ids]), isNull(schema.media.deletedAt)));
    return Object.fromEntries(rows.filter((r) => r.status !== 'BLOCKED' && r.status !== 'REJECTED').map((r) => [r.id, { kind: r.kind, mime: r.mime }]));
  }

  /** The file of a published version for participants: only media that the published document refers to. */
  async mediaFile(slug: string, mediaId: string): Promise<{ path: string; mime: string }> {
    const p = await this.published(slug);
    if (!JSON.stringify(p.doc).includes(`"${mediaId}"`)) throw unavailable();
    const [m] = await this.db
      .select({ mime: schema.media.mime, status: schema.media.status })
      .from(schema.media)
      .where(and(eq(schema.media.id, mediaId), eq(schema.media.ownerId, p.ownerId), isNull(schema.media.deletedAt)));
    if (!m || m.status === 'BLOCKED' || m.status === 'REJECTED') throw unavailable();
    return { path: this.storage.getPath(`${p.ownerId}/${mediaId}`), mime: m.mime };
  }

  /**
   * PL-02 · a scan of the QR code: counted for the access point, and the way to the current address of the project
   * (the code stays the same when the slug changes).
   */
  async scan(code: string, now = new Date()): Promise<{ slug: string; source: string }> {
    const [ap] = await this.db
      .select({ id: schema.accessPoints.id, projectId: schema.accessPoints.projectId, active: schema.accessPoints.active, slug: schema.projects.slug, status: schema.projects.status })
      .from(schema.accessPoints)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.accessPoints.projectId))
      .where(and(eq(schema.accessPoints.code, code), isNull(schema.projects.deletedAt)));
    if (!ap || !ap.active) throw unavailable();
    const day = now.toISOString().slice(0, 10);
    for (const accessPointId of [ap.id, '']) {
      await this.db
        .insert(schema.projectStatsDaily)
        .values({ projectId: ap.projectId, day, accessPointId, opens: 1 })
        .onConflictDoUpdate({ target: [schema.projectStatsDaily.projectId, schema.projectStatsDaily.day, schema.projectStatsDaily.accessPointId], set: { opens: sql`${schema.projectStatsDaily.opens} + 1` } });
    }
    return { slug: ap.slug, source: code };
  }
}
