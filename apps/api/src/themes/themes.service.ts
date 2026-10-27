import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import sharp from 'sharp';
import { type Db, schema } from '@blokum/db';
import {
  ThemeTokens,
  createId,
  dominantColors,
  themeColorsFromPalette,
  PALETTE_MAX,
  DEFAULT_COLORS,
} from '@blokum/schema';
import { DB } from '../tokens.js';
import { FREE_LIMITS } from '../media/entitlements.js';
import { LocalStorageService } from '../media/storage.js';

export interface ThemeDto {
  id: string;
  name: string;
  tokens: ThemeTokens;
  isSystem: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThemeSummary {
  id: string;
  name: string;
  isSystem: boolean;
  isDefault: boolean;
  colors: Record<string, string>;
  updatedAt: Date;
}

type Row = typeof schema.themes.$inferSelect;

const fail = (code: string, message: string, status: 400 | 402 | 404 = 400): HttpException =>
  new HttpException({ error: { code, message } }, status);

/** TH-01…TH-03 · themes of the creator: own themes, system ones to read and copy, the default for new projects. */
@Injectable()
export class ThemesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: LocalStorageService,
  ) {}

  private parseTokens(input: unknown): ThemeTokens {
    const parsed = ThemeTokens.safeParse(input ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new BadRequestException({
        error: {
          code: 'INVALID_THEME',
          message: `Тема не прошла проверку: ${issue?.message ?? 'неверная структура'}`,
          path: issue?.path.map(String),
        },
      });
    }
    return parsed.data;
  }

  private cleanName(name: unknown, fallback: string): string {
    const clean = typeof name === 'string' ? name.trim().slice(0, 80) : '';
    return clean || fallback;
  }

  private dto(r: Row): ThemeDto {
    return {
      id: r.id,
      name: r.name,
      tokens: r.tokens as unknown as ThemeTokens,
      isSystem: r.isSystem,
      isDefault: r.isDefault,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async list(userId: string, scope: 'mine' | 'system'): Promise<ThemeSummary[]> {
    const where =
      scope === 'system'
        ? and(eq(schema.themes.isSystem, true), isNull(schema.themes.deletedAt))
        : and(eq(schema.themes.ownerId, userId), eq(schema.themes.isSystem, false), isNull(schema.themes.deletedAt));
    const rows = await this.db
      .select()
      .from(schema.themes)
      .where(where)
      .orderBy(desc(schema.themes.updatedAt), asc(schema.themes.name));
    return rows
      .filter((r) => scope === 'mine' || r.publishedAt !== null)
      .map((r) => ({
        id: r.id,
        name: r.name,
        isSystem: r.isSystem,
        isDefault: r.isDefault,
        colors: (r.tokens as { colors?: Record<string, string> }).colors ?? {},
        updatedAt: r.updatedAt,
      }));
  }

  /** An own theme, or a published system one (read-only for everybody). */
  async get(userId: string, id: string): Promise<ThemeDto> {
    const [r] = await this.db
      .select()
      .from(schema.themes)
      .where(
        and(
          eq(schema.themes.id, id),
          isNull(schema.themes.deletedAt),
          or(
            eq(schema.themes.ownerId, userId),
            and(eq(schema.themes.isSystem, true), isNotNull(schema.themes.publishedAt)),
          ),
        ),
      );
    if (!r) throw fail('NOT_FOUND', 'Тема не найдена', 404);
    return this.dto(r);
  }

  private async own(userId: string, id: string): Promise<Row> {
    const [r] = await this.db
      .select()
      .from(schema.themes)
      .where(
        and(
          eq(schema.themes.id, id),
          eq(schema.themes.ownerId, userId),
          eq(schema.themes.isSystem, false),
          isNull(schema.themes.deletedAt),
        ),
      );
    if (!r) throw fail('NOT_FOUND', 'Тема не найдена', 404);
    return r;
  }

  private async checkLimit(userId: string): Promise<void> {
    const mine = await this.db
      .select({ id: schema.themes.id })
      .from(schema.themes)
      .where(
        and(eq(schema.themes.ownerId, userId), eq(schema.themes.isSystem, false), isNull(schema.themes.deletedAt)),
      );
    if (mine.length >= FREE_LIMITS.themes)
      throw fail(
        'QUOTA_EXCEEDED',
        `На тарифе «Старт» можно сделать до ${FREE_LIMITS.themes} своих тем. Удалите ненужную или перейдите на другой тариф.`,
        402,
      );
  }

  async create(userId: string, name: unknown, tokens: unknown): Promise<ThemeDto> {
    await this.checkLimit(userId);
    const [r] = await this.db
      .insert(schema.themes)
      .values({
        id: createId(),
        ownerId: userId,
        name: this.cleanName(name, 'Новая тема'),
        tokens: this.parseTokens(tokens),
      })
      .returning();
    return this.dto(r!);
  }

  async update(userId: string, id: string, body: { name?: unknown; tokens?: unknown }): Promise<ThemeDto> {
    await this.own(userId, id);
    const set: Partial<typeof schema.themes.$inferInsert> = {};
    if (body.name !== undefined) set.name = this.cleanName(body.name, 'Тема');
    if (body.tokens !== undefined) set.tokens = this.parseTokens(body.tokens);
    const [r] = await this.db
      .update(schema.themes)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(schema.themes.id, id))
      .returning();
    return this.dto(r!);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.own(userId, id);
    await this.db
      .update(schema.themes)
      .set({ deletedAt: new Date(), isDefault: false })
      .where(eq(schema.themes.id, id));
  }

  /** TH-02: a copy of any theme the person can see (own or system) becomes an own one. */
  async duplicate(userId: string, id: string): Promise<ThemeDto> {
    const source = await this.get(userId, id);
    return this.create(userId, `${source.name} (копия)`, source.tokens);
  }

  /** TH-03: the theme new projects start with; `false` takes it back. At most one per owner. */
  async setDefault(userId: string, id: string, value: boolean): Promise<ThemeDto> {
    await this.own(userId, id);
    return this.db.transaction(async (tx) => {
      if (value)
        await tx
          .update(schema.themes)
          .set({ isDefault: false })
          .where(and(eq(schema.themes.ownerId, userId), eq(schema.themes.isDefault, true)));
      const [r] = await tx.update(schema.themes).set({ isDefault: value }).where(eq(schema.themes.id, id)).returning();
      return this.dto(r!);
    });
  }

  async defaultOf(userId: string): Promise<ThemeDto | null> {
    const [r] = await this.db
      .select()
      .from(schema.themes)
      .where(
        and(eq(schema.themes.ownerId, userId), eq(schema.themes.isDefault, true), isNull(schema.themes.deletedAt)),
      );
    return r ? this.dto(r) : null;
  }

  /** TH-02: «сохранить оформление как тему» — the tokens of the project's draft. */
  async fromProject(userId: string, projectId: string, name: unknown): Promise<ThemeDto> {
    const [p] = await this.db
      .select({ title: schema.projects.title, draftVersionId: schema.projects.draftVersionId })
      .from(schema.projects)
      .where(
        and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId), isNull(schema.projects.deletedAt)),
      );
    if (!p?.draftVersionId) throw fail('NOT_FOUND', 'Сборка не найдена', 404);
    const [v] = await this.db
      .select({ document: schema.projectVersions.document })
      .from(schema.projectVersions)
      .where(eq(schema.projectVersions.id, p.draftVersionId));
    const tokens = (v?.document as { theme?: { tokens?: unknown } } | undefined)?.theme?.tokens;
    return this.create(userId, this.cleanName(name, `Оформление «${p.title}»`), tokens);
  }

  /** TH-02: a theme from a picture of the library: 5–8 colours, roles by brightness and contrast. */
  async fromImage(userId: string, mediaId: unknown, name: unknown): Promise<ThemeDto> {
    if (typeof mediaId !== 'string') throw fail('INVALID_INPUT', 'Не выбрана картинка');
    const [m] = await this.db
      .select({ kind: schema.media.kind, status: schema.media.status })
      .from(schema.media)
      .where(and(eq(schema.media.id, mediaId), eq(schema.media.ownerId, userId), isNull(schema.media.deletedAt)));
    if (!m || m.status === 'BLOCKED' || m.status === 'REJECTED') throw fail('NOT_FOUND', 'Картинка не найдена', 404);
    if (m.kind !== 'IMAGE' && m.kind !== 'GIF') throw fail('INVALID_INPUT', 'Для темы нужна картинка (фото или GIF)');
    await this.checkLimit(userId);
    let pixels: Buffer;
    try {
      pixels = await sharp(this.storage.getPath(`${userId}/${mediaId}`))
        .resize(64, 64, { fit: 'inside' })
        .removeAlpha()
        .raw()
        .toBuffer();
    } catch {
      throw fail('INVALID_INPUT', 'Не удалось прочитать картинку');
    }
    const colors = themeColorsFromPalette(dominantColors(pixels, PALETTE_MAX));
    const tokens = this.parseTokens({ colors: { ...DEFAULT_COLORS, ...colors } });
    return this.create(userId, this.cleanName(name, 'Тема из картинки'), tokens);
  }
}
