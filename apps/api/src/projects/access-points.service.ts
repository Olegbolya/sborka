import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { createId } from '@blokum/schema';
import { Inject } from '@nestjs/common';
import { DB } from '../tokens.js';
import { fail } from '../admin/errors.js';
import { LocalStorageService, servedKey } from '../media/storage.js';
import { type PrintLayout, type QrStyle, QrInputError, colourProblem, logoFromFile, parseQrStyle, readStoredStyle, renderPdf, renderPng, reads, buildSvg } from './qr-render.js';

export interface AccessPointDto {
  id: string;
  projectId: string;
  code: string;
  kind: string;
  label: string;
  active: boolean;
  createdAt: Date;
  /** Share URL for the access point. */
  url: string;
}

function slugCode(): string {
  return createId(8);
}

@Injectable()
export class AccessPointsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: LocalStorageService,
  ) {}

  /** Q-01: List all access points for a project. */
  async list(userId: string, projectId: string, webUrl: string): Promise<AccessPointDto[]> {
    await this.assertProjectOwner(userId, projectId);
    const rows = await this.db
      .select()
      .from(schema.accessPoints)
      .where(eq(schema.accessPoints.projectId, projectId))
      .orderBy(schema.accessPoints.createdAt);
    return rows.map((r) => ({ ...r, url: `${webUrl}/q/${r.code}` }));
  }

  /** Q-01: Create a new access point (LINK or QR). */
  async create(userId: string, projectId: string, webUrl: string, data: { label?: string; kind?: 'LINK' | 'QR' }): Promise<AccessPointDto> {
    await this.assertProjectOwner(userId, projectId);
    const id = createId();
    const code = slugCode();
    const label = data.label ?? 'Основная ссылка';
    const kind = data.kind ?? 'LINK';
    await this.db.insert(schema.accessPoints).values({ id, projectId, code, kind, label, active: true });
    return { id, projectId, code, kind, label, active: true, createdAt: new Date(), url: `${webUrl}/q/${code}` };
  }

  /** Q-07: Toggle active state of an access point. */
  async setActive(userId: string, pointId: string, active: boolean): Promise<void> {
    const ap = await this.getAndAuthorize(userId, pointId);
    if (ap.active === active) return;
    await this.db.update(schema.accessPoints).set({ active }).where(eq(schema.accessPoints.id, pointId));
  }

  /** Delete an access point. */
  async delete(userId: string, pointId: string): Promise<void> {
    await this.getAndAuthorize(userId, pointId);
    await this.db.delete(schema.accessPoints).where(eq(schema.accessPoints.id, pointId));
  }

  /** Q-03 · the look of the code of an access point. */
  async qrStyle(userId: string, pointId: string): Promise<QrStyle> {
    const ap = await this.getAndAuthorize(userId, pointId);
    return readStoredStyle(ap.qrStyle);
  }

  /**
   * Q-03, Q-05 · saves the look. A look that cannot be read is not saved: the colours are checked first, then the code is drawn
   * and decoded the way a phone does it.
   */
  async setQrStyle(userId: string, pointId: string, webUrl: string, input: unknown): Promise<QrStyle> {
    const ap = await this.getAndAuthorize(userId, pointId);
    let style: QrStyle;
    try {
      style = parseQrStyle(input);
    } catch (e) {
      if (e instanceof QrInputError) throw fail(400, 'INVALID_INPUT', e.message);
      throw e;
    }
    const colours = colourProblem(style);
    if (colours) throw fail(422, 'QR_UNREADABLE', colours);
    await this.drawChecked(ap, webUrl, style, 512);
    await this.db.update(schema.accessPoints).set({ qrStyle: style as unknown as Record<string, unknown> }).where(eq(schema.accessPoints.id, pointId));
    return style;
  }

  /** Q-02, Q-04, Q-05 · the code as PNG. */
  async generateQrPng(userId: string, pointId: string, webUrl: string, size: 1024 | 2048 | 4096 = 1024): Promise<Buffer> {
    const ap = await this.getAndAuthorize(userId, pointId);
    return this.drawChecked(ap, webUrl, readStoredStyle(ap.qrStyle), size);
  }

  /** Q-02, Q-04 · the code as SVG (after the same check as the picture: what is downloaded reads). */
  async generateQrSvg(userId: string, pointId: string, webUrl: string): Promise<string> {
    const ap = await this.getAndAuthorize(userId, pointId);
    const style = readStoredStyle(ap.qrStyle);
    await this.drawChecked(ap, webUrl, style, 512);
    const logo = await this.logoOf(ap, style);
    return buildSvg(`${webUrl}/q/${ap.code}`, style, logo, true).svg;
  }

  /** Q-04 · a sheet for print as PDF. */
  async generateQrPdf(userId: string, pointId: string, webUrl: string, layout: PrintLayout): Promise<Buffer> {
    const ap = await this.getAndAuthorize(userId, pointId);
    return renderPdf(await this.drawChecked(ap, webUrl, readStoredStyle(ap.qrStyle), 2048), layout);
  }

  private async drawChecked(ap: typeof schema.accessPoints.$inferSelect, webUrl: string, style: QrStyle, size: number): Promise<Buffer> {
    const url = `${webUrl}/q/${ap.code}`;
    const colours = colourProblem(style);
    if (colours) throw fail(422, 'QR_UNREADABLE', colours);
    const png = await renderPng(url, style, await this.logoOf(ap, style), size);
    if (!(await reads(png, url))) throw fail(422, 'QR_UNREADABLE', 'Этот QR не читается: камера не смогла его распознать. Уберите логотип или подпись, выберите квадратные точки и увеличьте контраст.');
    return png;
  }

  /** The logo is a picture from the media library of the owner of the project; one that is gone or blocked is left out. */
  private async logoOf(ap: typeof schema.accessPoints.$inferSelect, style: QrStyle): Promise<{ dataUri: string } | null> {
    if (!style.logoMediaId) return null;
    const [owner] = await this.db.select({ ownerId: schema.projects.ownerId }).from(schema.projects).where(eq(schema.projects.id, ap.projectId));
    if (!owner) return null;
    const [row] = await this.db
      .select({ mime: schema.media.mime, status: schema.media.status, variants: schema.media.variants })
      .from(schema.media)
      .where(and(eq(schema.media.id, style.logoMediaId), eq(schema.media.ownerId, owner.ownerId), isNull(schema.media.deletedAt)));
    if (!row || row.status === 'BLOCKED' || row.status === 'REJECTED' || !/^image\/(png|jpeg|webp|gif)$/.test(row.mime)) throw fail(400, 'INVALID_INPUT', 'Логотип: нужна картинка (PNG, JPG, WebP или GIF) из вашей медиатеки.');
    return logoFromFile(this.storage.getPath(servedKey(owner.ownerId, style.logoMediaId, row.variants)));
  }

  private async getAndAuthorize(userId: string, pointId: string): Promise<typeof schema.accessPoints.$inferSelect> {
    const rows = await this.db.select().from(schema.accessPoints).where(eq(schema.accessPoints.id, pointId));
    const ap = rows[0];
    if (!ap) throw new NotFoundException();
    await this.assertProjectOwner(userId, ap.projectId);
    return ap;
  }

  private async assertProjectOwner(userId: string, projectId: string): Promise<void> {
    const rows = await this.db
      .select({ ownerId: schema.projects.ownerId })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId)));
    const project = rows[0];
    if (!project) throw new NotFoundException();
    if (project.ownerId !== userId) throw new ForbiddenException();
  }
}
