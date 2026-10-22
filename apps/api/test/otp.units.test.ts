import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DevCaptchaVerifier } from '../src/auth/captcha.js';
import { DevOtpSender } from '../src/auth/otp-sender.js';
import { normalizePhone, OtpService } from '../src/auth/otp.service.js';
import type { OtpSender } from '../src/auth/otp-sender.js';
import type { CaptchaVerifier } from '../src/auth/captcha.js';
import { testConfig } from './helpers.js';

// ── Phone normalisation (A-01, TS-30) ────────────────────────────────────────

describe('A-01 · normalizePhone', () => {
  it('принимает +7XXXXXXXXXX', () => {
    expect(normalizePhone('+79991234567')).toBe('+79991234567');
  });
  it('принимает 7XXXXXXXXXX', () => {
    expect(normalizePhone('79991234567')).toBe('+79991234567');
  });
  it('принимает 8XXXXXXXXXX → меняет на +7', () => {
    expect(normalizePhone('89991234567')).toBe('+79991234567');
  });
  it('принимает 10 цифр → добавляет +7', () => {
    expect(normalizePhone('9991234567')).toBe('+79991234567');
  });
  it('отбрасывает пробелы и дефисы', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('+79991234567');
  });
  it('отклоняет слишком короткий номер', () => {
    expect(() => normalizePhone('1234')).toThrow(BadRequestException);
  });
  it('отклоняет слишком длинный номер', () => {
    expect(() => normalizePhone('123456789012345')).toThrow(BadRequestException);
  });
  it('отклоняет пустую строку', () => {
    expect(() => normalizePhone('')).toThrow(BadRequestException);
  });
  it('TS-30 · отклоняет номер не +7 (иностранный)', () => {
    expect(() => normalizePhone('+12025551234')).toThrow(BadRequestException);
  });
});

// ── DevOtpSender (TS-30) ─────────────────────────────────────────────────────

describe('TS-30 · DevOtpSender', () => {
  it('запускается вне production', () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(() => new DevOtpSender()).not.toThrow();
    process.env.NODE_ENV = orig;
  });
  it('TS-30 · падает в production', () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(() => new DevOtpSender()).toThrow('запрещён в рабочей среде');
    process.env.NODE_ENV = orig;
  });
});

// ── DevCaptchaVerifier (TS-30) ────────────────────────────────────────────────

describe('TS-30 · DevCaptchaVerifier', () => {
  it('запускается вне production', () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    expect(() => new DevCaptchaVerifier()).not.toThrow();
    process.env.NODE_ENV = orig;
  });
  it('TS-30 · падает в production', () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(() => new DevCaptchaVerifier()).toThrow('запрещён в рабочей среде');
    process.env.NODE_ENV = orig;
  });
  it('всегда возвращает true', async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    const v = new DevCaptchaVerifier();
    await expect(v.verify('any', '1.2.3.4')).resolves.toBe(true);
    process.env.NODE_ENV = orig;
  });
});

// ── OtpService unit (mocked DB, sender, captcha) ──────────────────────────────

function makeOtpMocks(overrides: { countReturns?: number[]; selectReturns?: unknown[] } = {}) {
  let selectCallIndex = 0;
  const countReturns = overrides.countReturns ?? [0, 0, 0, 0];
  const selectReturns = overrides.selectReturns ?? [];

  const countSelect = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([{ n: countReturns[selectCallIndex++] ?? 0 }])),
    })),
  }));

  const dataSelect = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectReturns)),
        })),
      })),
    })),
  }));

  const select = vi.fn((args?: unknown) => {
    if (args && typeof args === 'object' && 'n' in args) {
      return countSelect();
    }
    return dataSelect();
  });

  const db = {
    select,
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve([])) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
  };
  return db;
}

describe('A-01 · OtpService.requestCode', () => {
  it('отклоняет неверную капчу', async () => {
    const sender: OtpSender = { sendCode: vi.fn() };
    const captcha: CaptchaVerifier = { verify: vi.fn().mockResolvedValue(false) };
    const db = makeOtpMocks();
    const sessions = { create: vi.fn() };
    const svc = new OtpService(db as never, testConfig, sender, captcha, sessions as never);
    await expect(svc.requestCode('+79991234567', 'bad', '1.2.3.4')).rejects.toThrow(BadRequestException);
    expect(sender.sendCode).not.toHaveBeenCalled();
  });

  it('TS-30 · отклоняет при превышении лимита по номеру (час)', async () => {
    const sender: OtpSender = { sendCode: vi.fn() };
    const captcha: CaptchaVerifier = { verify: vi.fn().mockResolvedValue(true) };
    const db = makeOtpMocks({ countReturns: [3, 0, 0, 0] });
    const sessions = { create: vi.fn() };
    const svc = new OtpService(db as never, testConfig, sender, captcha, sessions as never);
    await expect(svc.requestCode('+79991234567', 'ok', '1.2.3.4')).rejects.toBeInstanceOf(HttpException);
    expect(sender.sendCode).not.toHaveBeenCalled();
  });

  it('TS-30 · отклоняет при превышении лимита по номеру (сутки)', async () => {
    const sender: OtpSender = { sendCode: vi.fn() };
    const captcha: CaptchaVerifier = { verify: vi.fn().mockResolvedValue(true) };
    const db = makeOtpMocks({ countReturns: [0, 10, 0, 0] });
    const sessions = { create: vi.fn() };
    const svc = new OtpService(db as never, testConfig, sender, captcha, sessions as never);
    await expect(svc.requestCode('+79991234567', 'ok', '1.2.3.4')).rejects.toBeInstanceOf(HttpException);
    expect(sender.sendCode).not.toHaveBeenCalled();
  });

  it('TS-30 · отклоняет при превышении лимита по IP', async () => {
    const sender: OtpSender = { sendCode: vi.fn() };
    const captcha: CaptchaVerifier = { verify: vi.fn().mockResolvedValue(true) };
    const db = makeOtpMocks({ countReturns: [0, 0, 5, 0] });
    const sessions = { create: vi.fn() };
    const svc = new OtpService(db as never, testConfig, sender, captcha, sessions as never);
    await expect(svc.requestCode('+79991234567', 'ok', '1.2.3.4')).rejects.toBeInstanceOf(HttpException);
    expect(sender.sendCode).not.toHaveBeenCalled();
  });

  it('TS-30 · отклоняет при превышении суточного бюджета СМС', async () => {
    const sender: OtpSender = { sendCode: vi.fn() };
    const captcha: CaptchaVerifier = { verify: vi.fn().mockResolvedValue(true) };
    const db = makeOtpMocks({ countReturns: [0, 0, 0, 1000] });
    const sessions = { create: vi.fn() };
    const svc = new OtpService(db as never, testConfig, sender, captcha, sessions as never);
    await expect(svc.requestCode('+79991234567', 'ok', '1.2.3.4')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sender.sendCode).not.toHaveBeenCalled();
  });

  it('отправляет код при прохождении всех проверок', async () => {
    const sender: OtpSender = { sendCode: vi.fn().mockResolvedValue(undefined) };
    const captcha: CaptchaVerifier = { verify: vi.fn().mockResolvedValue(true) };
    const db = makeOtpMocks({ countReturns: [0, 0, 0, 0] });
    const sessions = { create: vi.fn() };
    const svc = new OtpService(db as never, testConfig, sender, captcha, sessions as never);
    await svc.requestCode('+79991234567', 'ok', '1.2.3.4');
    expect(sender.sendCode).toHaveBeenCalledWith('+79991234567', expect.stringMatching(/^\d{6}$/));
  });
});

describe('A-01 · OtpService.verifyCode', () => {
  const futureExpiry = new Date(Date.now() + 60_000);

  it('отклоняет если OTP не найден', async () => {
    const sender: OtpSender = { sendCode: vi.fn() };
    const captcha: CaptchaVerifier = { verify: vi.fn().mockResolvedValue(true) };
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) })) })), insert: vi.fn(), update: vi.fn() };
    const sessions = { create: vi.fn() };
    const svc = new OtpService(db as never, testConfig, sender, captcha, sessions as never);
    await expect(svc.verifyCode('+79991234567', '123456', '1.2.3.4', '')).rejects.toThrow(BadRequestException);
  });

  it('отклоняет при превышении числа попыток', async () => {
    const otpRow = { id: 'otp1', phoneE164: '+79991234567', codeHash: 'x', attempts: 5, expiresAt: futureExpiry, usedAt: null, ipHash: 'h', createdAt: new Date() };
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([otpRow]) })) })) })) })), update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })), insert: vi.fn() };
    const sender: OtpSender = { sendCode: vi.fn() };
    const captcha: CaptchaVerifier = { verify: vi.fn() };
    const sessions = { create: vi.fn() };
    const svc = new OtpService(db as never, testConfig, sender, captcha, sessions as never);
    await expect(svc.verifyCode('+79991234567', '000000', '1.2.3.4', '')).rejects.toThrow(BadRequestException);
  });

  it('отклоняет неверный код и увеличивает счётчик попыток', async () => {
    const otpRow = { id: 'otp1', phoneE164: '+79991234567', codeHash: 'wronghash', attempts: 0, expiresAt: futureExpiry, usedAt: null, ipHash: 'h', createdAt: new Date() };
    const updateWhere = vi.fn().mockResolvedValue([]);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([otpRow]) })) })) })) })), update: vi.fn(() => ({ set: updateSet })), insert: vi.fn() };
    const sender: OtpSender = { sendCode: vi.fn() };
    const captcha: CaptchaVerifier = { verify: vi.fn() };
    const sessions = { create: vi.fn() };
    const svc = new OtpService(db as never, testConfig, sender, captcha, sessions as never);
    await expect(svc.verifyCode('+79991234567', '000000', '1.2.3.4', '')).rejects.toThrow(BadRequestException);
    expect(updateSet).toHaveBeenCalledWith({ attempts: 1 });
  });
});

// ── smsDailyBudget config (TS-30) ─────────────────────────────────────────────

import { loadApiConfig } from '../src/config.js';

describe('TS-30 · smsDailyBudget config', () => {
  it('по умолчанию 1000', () => {
    expect(loadApiConfig({}).smsDailyBudget).toBe(1000);
  });
  it('читает SMS_DAILY_BUDGET из окружения', () => {
    expect(loadApiConfig({ SMS_DAILY_BUDGET: '500' }).smsDailyBudget).toBe(500);
  });
  it('отклоняет отрицательное значение', () => {
    expect(() => loadApiConfig({ SMS_DAILY_BUDGET: '-1' })).toThrow();
  });
  it('нулевой бюджет (смс отключены) принимается', () => {
    expect(loadApiConfig({ SMS_DAILY_BUDGET: '0' }).smsDailyBudget).toBe(0);
  });
});
