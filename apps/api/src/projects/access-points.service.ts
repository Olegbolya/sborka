import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { createId } from '@blokum/schema';
import { Inject } from '@nestjs/common';
import { DB } from '../tokens.js';
import QRCode from 'qrcode';

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
  constructor(@Inject(DB) private readonly db: Db) {}

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

  /** Q-02/Q-04/Q-05: Generate QR PNG buffer for /q/{code}. */
  async generateQrPng(userId: string, pointId: string, webUrl: string, size: 1024 | 2048 | 4096 = 1024): Promise<Buffer> {
    const ap = await this.getAndAuthorize(userId, pointId);
    const url = `${webUrl}/q/${ap.code}`;
    return QRCode.toBuffer(url, {
      type: 'png',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#ffffff' },
    });
  }

  /** Q-02/Q-04: Generate QR SVG string for /q/{code}. */
  async generateQrSvg(userId: string, pointId: string, webUrl: string): Promise<string> {
    const ap = await this.getAndAuthorize(userId, pointId);
    const url = `${webUrl}/q/${ap.code}`;
    return QRCode.toString(url, {
      type: 'svg',
      margin: 2,
      errorCorrectionLevel: 'H',
    });
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
