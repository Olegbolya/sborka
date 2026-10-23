import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import { Workbook } from 'exceljs';
import { DB } from '../tokens.js';
import { ResponsesService } from './responses.service.js';

@Injectable()
export class ExportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly responses: ResponsesService,
  ) {}

  /** D-06: Export all responses for a project as CSV (UTF-8 + BOM). */
  async exportCsv(userId: string, projectId: string): Promise<Buffer> {
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
    const rows = await this.fetchAllResponses(userId, projectId);
    const headers = this.buildHeaders(rows);
    const wb = new Workbook();
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
        base[`ответ_${key}`] = JSON.stringify(a.value);
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

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
