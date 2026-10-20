/** Licenses allowed for bundled assets and library items (docs/05-LEGAL.md §2.10, LB-01). */
export const ALLOWED_LICENSES = ['own', 'OFL-1.1', 'CC0-1.0', 'MIT', 'Apache-2.0', 'CC-BY-4.0'] as const;
export type AssetLicense = (typeof ALLOWED_LICENSES)[number];

export interface LicenseRecord {
  license: string;
  author?: string;
  source?: string;
  attribution?: string;
}

/** Returns human-readable problems of a license record; an empty list means the record is valid. */
export function validateLicenseRecord(record: LicenseRecord): string[] {
  const problems: string[] = [];
  if (!(ALLOWED_LICENSES as readonly string[]).includes(record.license)) {
    problems.push(`Лицензия «${record.license}» не из разрешённого списка`);
  }
  if (!record.author?.trim()) problems.push('Не указан автор');
  if (!record.source?.trim()) problems.push('Не указан источник');
  if (record.license === 'CC-BY-4.0' && !record.attribution?.trim()) {
    problems.push('Для CC-BY-4.0 обязательна строка указания авторства');
  }
  return problems;
}
