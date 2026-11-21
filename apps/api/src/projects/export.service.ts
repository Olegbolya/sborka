import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import ExcelJS from 'exceljs';
import { DB } from '../tokens.js';
import { fail } from '../admin/errors.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { ResponsesService } from './responses.service.js';

@Injectable()
export class ExportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly responses: ResponsesService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** 04-TARIFFS §2: «Экспорт ответов» — нет / CSV / CSV + XLSX. */
  private async assertFormat(userId: string, projectId: string, format: 'csv' | 'xlsx'): Promise<void> {
    const { plan } = await this.entitlements.limitsOfProject(userId, projectId);
    if (!plan.limits.exportFormats.includes(format)) throw fail(402, 'PLAN_LIMIT', `Выгрузка ответов в ${format.toUpperCase()} недоступна на тарифе «${plan.title}».`);
  }

  /** D-06: Export all responses for a project as CSV (UTF-8 + BOM). */
  async exportCsv(userId: string, projectId: string): Promise<Buffer> {
    await this.assertFormat(userId, projectId, 'csv');
    const rows = await this.fetchAllResponses(userId, projectId);
    const headers = this.buildHeaders(rows);
    const lines: string[] = [headers.map(csvEscape).join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => csvEscape(String(row[h] ?? ''))).join(','));
    }
    const bom = '﻿';
    return Buffer.from(bom + lines.join('\r\n'), 'utf8');
  }

  /** D-06: Export all responses for a project as XLSX. */
  async exportXlsx(userId: string, projectId: string): Promise<Buffer> {
    await this.assertFormat(userId, projectId, 'xlsx');
    const rows = await this.fetchAllResponses(userId, projectId);
    const headers = this.buildHeaders(rows);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ответы');
    ws.addRow(headers);
    for (const row of rows) {
      ws.addRow(headers.map((h) => row[h] ?? ''));
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async fetchAllResponses(userId: string, projectId: string): Promise<Array<Record<string, string>>> {
    const page = await this.responses.listResponses(userId, projectId, { limit: 200 });
    let allItems = [...page.items];
    let cursor = page.nextCursor;
    while (cursor) {
      const next = await this.responses.listResponses(userId, projectId, { cursor, limit: 200 });
      allItems = [...allItems, ...next.items];
      cursor = next.nextCursor;
    }

    const sessionIds = allItems.map((s) => s.id);
    const allAnswers =
      sessionIds.length === 0
        ? []
        : await this.db
            .select({
              sessionId: schema.answers.sessionId,
              blockId: schema.answers.blockId,
              variableId: schema.answers.variableId,
              value: schema.answers.value,
              deviceReported: schema.answers.deviceReported,
            })
            .from(schema.answers)
            .where(inArray(schema.answers.sessionId, sessionIds))
            .orderBy(schema.answers.answeredAt);

    return allItems.map((s) => {
      const base: Record<string, string> = {
        id: s.id,
        статус: s.status,
        начало: s.startedAt.toISOString(),
        завершение: s.completedAt?.toISOString() ?? '',
        длительность_мс: String(s.durationMs ?? ''),
        устройство: s.deviceType,
        баллы: String(s.score ?? ''),
        результат: s.resultKey ?? '',
        источник: s.accessPointId ?? '',
      };
      const sessionAnswers = allAnswers.filter((a) => a.sessionId === s.id);
      for (const a of sessionAnswers) {
        const key = a.blockId ?? a.variableId ?? 'ответ';
        // RN-02: a value of a game is worked out on the participant's device; the column says so.
        base[`ответ_${key}${a.deviceReported ? DEVICE_NOTE : ''}`] = JSON.stringify(a.value);
      }
      return base;
    });
  }

  private buildHeaders(rows: Array<Record<string, string>>): string[] {
    const base = ['id', 'статус', 'начало', 'завершение', 'длительность_мс', 'устройство', 'баллы', 'результат', 'источник'];
    const extra = new Set<string>();
    for (const row of rows) {
      for (const k of Object.keys(row)) {
        if (!base.includes(k)) extra.add(k);
      }
    }
    return [...base, ...extra];
  }
}

/** RN-02 · the mark on a column whose values the device of the participant reported. */
export const DEVICE_NOTE = ' (посчитано на устройстве)';

/**
 * ASVS V5.3 · CWE-1236 · a cell that starts with = + - @ (or a tab / carriage return) is read by Excel and LibreOffice as a formula: a
 * participant could type `=HYPERLINK(…)` and it would run on the creator's computer. Such a cell gets a leading apostrophe — the
 * spreadsheet shows the text as typed. Plain numbers like «-5» stay numbers.
 */
export function neutralizeFormula(val: string): string {
  if (/^-?\d+([.,]\d+)?$/.test(val)) return val;
  return /^[=+\-@\t\r]/.test(val) ? `'${val}` : val;
}

function csvEscape(raw: string): string {
  const val = neutralizeFormula(raw);
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
